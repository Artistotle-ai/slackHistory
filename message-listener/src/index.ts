import { DynamoDB } from "aws-sdk";
import { SecretsManager } from "aws-sdk";
import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
  SlackEvent,
  MessageItem,
  ChannelItem,
} from "mnemosyne-slack-shared";
import {
  verifySlackSignature,
  whitelistFileMetadata,
  capArray,
  getMessageItemId,
  getChannelItemId,
  getThreadParent,
} from "mnemosyne-slack-shared";

const dynamoDb = new DynamoDB.DocumentClient();
const secretsManager = new SecretsManager({ region: process.env.AWS_REGION || "eu-west-1" });

// Cache for secrets (in-memory cache for Lambda invocations)
let signingSecretCache: string | null = null;
let botTokenCache: string | null = null;

/**
 * Get signing secret from Secrets Manager (with caching)
 */
async function getSigningSecret(): Promise<string> {
  if (signingSecretCache) {
    return signingSecretCache;
  }

  const secretArn = process.env.SLACK_SIGNING_SECRET_ARN;
  if (!secretArn) {
    throw new Error("SLACK_SIGNING_SECRET_ARN environment variable not set");
  }

  const response = await secretsManager.getSecretValue({ SecretId: secretArn }).promise();
  const secretString = response.SecretString;
  if (!secretString) {
    throw new Error("Signing secret not found in Secrets Manager");
  }

  signingSecretCache = secretString;
  return secretString;
}

/**
 * Get bot token from Secrets Manager (reserved for future use)
 */
async function getBotToken(): Promise<string | null> {
  const tokenArn = process.env.SLACK_BOT_TOKEN_ARN;
  if (!tokenArn) {
    return null;
  }

  if (botTokenCache) {
    return botTokenCache;
  }

  try {
    const response = await secretsManager.getSecretValue({ SecretId: tokenArn }).promise();
    botTokenCache = response.SecretString || null;
    return botTokenCache;
  } catch (error) {
    console.warn("Bot token not available:", error);
    return null;
  }
}

/**
 * Handle URL verification challenge from Slack
 */
function handleUrlVerification(event: SlackEvent): LambdaFunctionURLResponse {
  if (event.type === "url_verification" && event.challenge) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: event.challenge }),
    };
  }
  throw new Error("Invalid URL verification request");
}

/**
 * Handle message event (new message)
 */
async function handleMessage(
  event: SlackEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  // Ignore certain subtypes
  if (event.subtype === "channel_join" || event.subtype === "channel_leave") {
    return;
  }

  const itemId = getMessageItemId(teamId, channelId);
  const timestamp = event.ts || event.event_ts || String(Date.now() / 1000);

  const item: MessageItem = {
    itemId,
    timestamp,
    type: "message",
    team_id: teamId,
    channel_id: channelId,
    ts: timestamp,
    raw_event: event,
  };

  if (event.text) {
    item.text = event.text;
  }

  if (event.user) {
    item.user = event.user;
  }

  if (event.thread_ts) {
    item.thread_ts = event.thread_ts;
    // Set parent attribute for GSI
    if (event.thread_ts === event.ts) {
      // Parent message (thread_ts === ts)
      item.parent = getThreadParent(teamId, event.thread_ts);
    } else {
      // Thread reply (thread_ts !== ts)
      item.parent = getThreadParent(teamId, event.thread_ts);
    }
  }

  // Whitelist file metadata if present
  if (event.files && event.files.length > 0) {
    item.files = event.files.map(whitelistFileMetadata);
  }

  await dynamoDb
    .put({
      TableName: tableName,
      Item: item,
    })
    .promise();

  console.log(`Stored message: ${itemId}, timestamp: ${timestamp}`);
}

/**
 * Handle message_changed event (edit)
 */
async function handleMessageChanged(
  event: SlackEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const message = event.message || event.previous_message;
  if (!message || !message.ts) {
    throw new Error("Invalid message_changed event: missing message.ts");
  }

  const itemId = getMessageItemId(teamId, channelId);
  const timestamp = message.ts;
  const updatedTs = event.edited?.ts || event.event_ts || new Date().toISOString();

  const updateExpression = [
    "SET text = :text",
    "raw_event = :raw_event",
    "updated_ts = :updated_ts",
  ];

  const expressionAttributeValues: any = {
    ":text": message.text || "",
    ":raw_event": event,
    ":updated_ts": updatedTs,
  };

  // Update additional fields if present
  if (message.user) {
    updateExpression.push("user = :user");
    expressionAttributeValues[":user"] = message.user;
  }

  try {
    await dynamoDb
      .update({
        TableName: tableName,
        Key: {
          itemId,
          timestamp,
        },
        UpdateExpression: `SET ${updateExpression.join(", ")}`,
        ExpressionAttributeValues: expressionAttributeValues,
      })
      .promise();

    console.log(`Updated message: ${itemId}, timestamp: ${timestamp}`);
  } catch (error: any) {
    // If item doesn't exist, create it (upsert semantics)
    if (error.code === "ValidationException" || error.code === "ResourceNotFoundException") {
      const item: MessageItem = {
        itemId,
        timestamp,
        type: "message",
        team_id: teamId,
        channel_id: channelId,
        ts: timestamp,
        text: message.text || "",
        raw_event: event,
        updated_ts: updatedTs,
      };

      if (message.user) {
        item.user = message.user;
      }

      await dynamoDb
        .put({
          TableName: tableName,
          Item: item,
        })
        .promise();

      console.log(`Created missing message item: ${itemId}, timestamp: ${timestamp}`);
    } else {
      throw error;
    }
  }
}

/**
 * Handle message_deleted event
 */
async function handleMessageDeleted(
  event: SlackEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const deletedTs = event.deleted_ts || event.ts || event.event_ts;
  if (!deletedTs) {
    throw new Error("Invalid message_deleted event: missing timestamp");
  }

  const itemId = getMessageItemId(teamId, channelId);
  const timestamp = deletedTs;

  await dynamoDb
    .update({
      TableName: tableName,
      Key: {
        itemId,
        timestamp,
      },
      UpdateExpression: "SET deleted = :true",
      ExpressionAttributeValues: {
        ":true": true,
      },
    })
    .promise();

  console.log(`Marked message as deleted: ${itemId}, timestamp: ${timestamp}`);
}

/**
 * Handle channel_created event
 */
async function handleChannelCreated(
  event: SlackEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);
  const name = event.name || channelId;

  const item: ChannelItem = {
    itemId,
    timestamp,
    type: "channel",
    team_id: teamId,
    channel_id: channelId,
    name,
    names_history: [name],
    visibility: "public",
    raw_event: event,
  };

  await dynamoDb
    .put({
      TableName: tableName,
      Item: item,
    })
    .promise();

  console.log(`Created channel: ${itemId}, name: ${name}`);
}

/**
 * Handle channel_rename event
 */
async function handleChannelRename(
  event: SlackEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const itemId = getChannelItemId(teamId, channelId);
  const newName = event.name || channelId;
  const timestamp = event.event_ts || String(Date.now() / 1000);

  // Get current channel item to preserve names_history
  try {
    // Query for the latest channel item (highest timestamp)
    const queryResult = await dynamoDb
      .query({
        TableName: tableName,
        KeyConditionExpression: "itemId = :itemId",
        ExpressionAttributeValues: {
          ":itemId": itemId,
        },
        ScanIndexForward: false, // Descending order
        Limit: 1,
      })
      .promise();

    let namesHistory: string[] = [newName];
    if (queryResult.Items && queryResult.Items.length > 0) {
      const currentItem = queryResult.Items[0] as ChannelItem;
      if (currentItem.names_history && currentItem.names_history.length > 0) {
        namesHistory = [...currentItem.names_history, newName];
        namesHistory = capArray(namesHistory, 20);
      } else {
        namesHistory = [(currentItem.name || channelId), newName];
        namesHistory = capArray(namesHistory, 20);
      }

      // Update the latest channel item with new name and history
      await dynamoDb
        .update({
          TableName: tableName,
          Key: {
            itemId,
            timestamp: currentItem.timestamp,
          },
          UpdateExpression: "SET name = :name, names_history = :names_history, raw_event = :raw_event",
          ExpressionAttributeValues: {
            ":name": newName,
            ":names_history": namesHistory,
            ":raw_event": event,
          },
        })
        .promise();
    } else {
      // Channel doesn't exist, create it
      const item: ChannelItem = {
        itemId,
        timestamp,
        type: "channel",
        team_id: teamId,
        channel_id: channelId,
        name: newName,
        names_history: [newName],
        visibility: "public",
        raw_event: event,
      };

      await dynamoDb
        .put({
          TableName: tableName,
          Item: item,
        })
        .promise();
    }
  } catch (error: any) {
    console.error("Error handling channel rename:", error);
    throw error;
  }

  console.log(`Renamed channel: ${itemId}, new name: ${newName}`);
}

/**
 * Handle channel_deleted event
 */
async function handleChannelDeleted(
  event: SlackEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);

  // Get latest channel item
  const queryResult = await dynamoDb
    .query({
      TableName: tableName,
      KeyConditionExpression: "itemId = :itemId",
      ExpressionAttributeValues: {
        ":itemId": itemId,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
    .promise();

  const updateTimestamp = queryResult.Items?.[0]?.timestamp || timestamp;

  await dynamoDb
    .update({
      TableName: tableName,
      Key: {
        itemId,
        timestamp: updateTimestamp,
      },
      UpdateExpression: "SET deleted = :true, raw_event = :raw_event",
      ExpressionAttributeValues: {
        ":true": true,
        ":raw_event": event,
      },
    })
    .promise();

  console.log(`Marked channel as deleted: ${itemId}`);
}

/**
 * Handle channel_archive event
 */
async function handleChannelArchive(
  event: SlackEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);

  const queryResult = await dynamoDb
    .query({
      TableName: tableName,
      KeyConditionExpression: "itemId = :itemId",
      ExpressionAttributeValues: {
        ":itemId": itemId,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
    .promise();

  const updateTimestamp = queryResult.Items?.[0]?.timestamp || timestamp;

  await dynamoDb
    .update({
      TableName: tableName,
      Key: {
        itemId,
        timestamp: updateTimestamp,
      },
      UpdateExpression: "SET archived = :true, raw_event = :raw_event",
      ExpressionAttributeValues: {
        ":true": true,
        ":raw_event": event,
      },
    })
    .promise();

  console.log(`Archived channel: ${itemId}`);
}

/**
 * Handle channel_unarchive event
 */
async function handleChannelUnarchive(
  event: SlackEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);

  const queryResult = await dynamoDb
    .query({
      TableName: tableName,
      KeyConditionExpression: "itemId = :itemId",
      ExpressionAttributeValues: {
        ":itemId": itemId,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
    .promise();

  const updateTimestamp = queryResult.Items?.[0]?.timestamp || timestamp;

  await dynamoDb
    .update({
      TableName: tableName,
      Key: {
        itemId,
        timestamp: updateTimestamp,
      },
      UpdateExpression: "REMOVE archived SET raw_event = :raw_event",
      ExpressionAttributeValues: {
        ":raw_event": event,
      },
    })
    .promise();

  console.log(`Unarchived channel: ${itemId}`);
}

/**
 * Handle channel_id_changed event
 */
async function handleChannelIdChanged(
  event: SlackEvent,
  teamId: string,
  oldChannelId: string,
  newChannelId: string
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  // Get old channel item
  const oldItemId = getChannelItemId(teamId, oldChannelId);
  const queryResult = await dynamoDb
    .query({
      TableName: tableName,
      KeyConditionExpression: "itemId = :itemId",
      ExpressionAttributeValues: {
        ":itemId": oldItemId,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
    .promise();

  const oldChannel = queryResult.Items?.[0] as ChannelItem | undefined;

  // Create new channel item
  const newItemId = getChannelItemId(teamId, newChannelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);

  const item: ChannelItem = {
    itemId: newItemId,
    timestamp,
    type: "channel",
    team_id: teamId,
    channel_id: newChannelId,
    name: oldChannel?.name || newChannelId,
    names_history: oldChannel?.names_history || [newChannelId],
    visibility: oldChannel?.visibility || "public",
    prev_channel_id: oldChannelId,
    raw_event: event,
  };

  if (oldChannel?.purpose) {
    item.purpose = oldChannel.purpose;
  }
  if (oldChannel?.topic) {
    item.topic = oldChannel.topic;
  }

  await dynamoDb
    .put({
      TableName: tableName,
      Item: item,
    })
    .promise();

  console.log(`Channel ID changed: ${oldChannelId} -> ${newChannelId}`);
}

/**
 * Handle channel_purpose or channel_topic event
 */
async function handleChannelPurposeOrTopic(
  event: SlackEvent,
  teamId: string,
  channelId: string,
  field: "purpose" | "topic"
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);
  const value = event[field] || event.purpose || event.topic || "";

  const queryResult = await dynamoDb
    .query({
      TableName: tableName,
      KeyConditionExpression: "itemId = :itemId",
      ExpressionAttributeValues: {
        ":itemId": itemId,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
    .promise();

  const updateTimestamp = queryResult.Items?.[0]?.timestamp || timestamp;

  await dynamoDb
    .update({
      TableName: tableName,
      Key: {
        itemId,
        timestamp: updateTimestamp,
      },
      UpdateExpression: `SET ${field} = :value, raw_event = :raw_event`,
      ExpressionAttributeValues: {
        ":value": value,
        ":raw_event": event,
      },
    })
    .promise();

  console.log(`Updated channel ${field}: ${itemId}`);
}

/**
 * Handle channel_convert_to_private or channel_convert_to_public event
 */
async function handleChannelVisibilityChange(
  event: SlackEvent,
  teamId: string,
  channelId: string,
  visibility: "private" | "public"
): Promise<void> {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable not set");
  }

  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);

  const queryResult = await dynamoDb
    .query({
      TableName: tableName,
      KeyConditionExpression: "itemId = :itemId",
      ExpressionAttributeValues: {
        ":itemId": itemId,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
    .promise();

  const updateTimestamp = queryResult.Items?.[0]?.timestamp || timestamp;

  await dynamoDb
    .update({
      TableName: tableName,
      Key: {
        itemId,
        timestamp: updateTimestamp,
      },
      UpdateExpression: "SET visibility = :visibility, raw_event = :raw_event",
      ExpressionAttributeValues: {
        ":visibility": visibility,
        ":raw_event": event,
      },
    })
    .promise();

  console.log(`Changed channel visibility: ${itemId}, visibility: ${visibility}`);
}

/**
 * Route event to appropriate handler
 */
async function routeEvent(event: SlackEvent): Promise<void> {
  const teamId = event.team_id;
  const channelId = event.channel || event.channel_id;

  if (!teamId) {
    throw new Error("Missing team_id in event");
  }

  // Handle message events
  if (event.type === "message") {
    if (!channelId) {
      console.warn("Message event missing channel_id, skipping");
      return;
    }

    if (event.subtype === "message_changed") {
      await handleMessageChanged(event, teamId, channelId);
    } else if (event.subtype === "message_deleted") {
      await handleMessageDeleted(event, teamId, channelId);
    } else {
      await handleMessage(event, teamId, channelId);
    }
    return;
  }

  // Handle channel events
  if (event.type.startsWith("channel_")) {
    if (!channelId) {
      console.warn(`Channel event ${event.type} missing channel_id, skipping`);
      return;
    }

    switch (event.type) {
      case "channel_created":
        await handleChannelCreated(event, teamId, channelId);
        break;
      case "channel_rename":
        await handleChannelRename(event, teamId, channelId);
        break;
      case "channel_deleted":
        await handleChannelDeleted(event, teamId, channelId);
        break;
      case "channel_archive":
        await handleChannelArchive(event, teamId, channelId);
        break;
      case "channel_unarchive":
        await handleChannelUnarchive(event, teamId, channelId);
        break;
      case "channel_purpose":
        await handleChannelPurposeOrTopic(event, teamId, channelId, "purpose");
        break;
      case "channel_topic":
        await handleChannelPurposeOrTopic(event, teamId, channelId, "topic");
        break;
      case "channel_convert_to_private":
        await handleChannelVisibilityChange(event, teamId, channelId, "private");
        break;
      case "channel_convert_to_public":
        await handleChannelVisibilityChange(event, teamId, channelId, "public");
        break;
      default:
        // Handle channel_id_changed if present
        if (event.channel && event.previous_channel) {
          await handleChannelIdChanged(event, teamId, event.previous_channel, event.channel);
        } else {
          console.log(`Unknown channel event type: ${event.type}`);
        }
    }
    return;
  }

  console.log(`Unknown event type: ${event.type}, ignoring`);
}

/**
 * Main Lambda handler for Function URL
 */
export const handler = async (
  request: LambdaFunctionURLRequest
): Promise<LambdaFunctionURLResponse> => {
  try {
    // Parse request body
    const body = request.body || "{}";
    const headers = request.headers || {};

    // Handle URL verification challenge
    try {
      const event: SlackEvent = JSON.parse(body);
      if (event.type === "url_verification") {
        return handleUrlVerification(event);
      }
    } catch (e) {
      // Continue to signature verification if not JSON
    }

    // Verify Slack signature
    const signature = headers["x-slack-signature"] || headers["X-Slack-Signature"];
    const timestamp = headers["x-slack-request-timestamp"] || headers["X-Slack-Request-Timestamp"];

    if (!signature || !timestamp) {
      console.error("Missing Slack signature headers");
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const signingSecret = await getSigningSecret();
    if (!verifySlackSignature(signingSecret, signature, timestamp, body)) {
      console.error("Invalid Slack signature");
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    // Parse event
    let event: SlackEvent;
    try {
      event = JSON.parse(body);
    } catch (error) {
      console.error("Invalid JSON in request body:", error);
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Bad Request: Invalid JSON" }),
      };
    }

    // Route and handle event
    await routeEvent(event);

  return {
    statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (error: any) {
    console.error("Error processing event:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};
