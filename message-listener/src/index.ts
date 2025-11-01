import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
  SlackEvent,
  MessageItem,
  ChannelItem,
  StrictSlackEvent,
  MessageEvent,
  MessageChangedEvent,
  MessageDeletedEvent,
  ChannelCreatedEvent,
  ChannelRenameEvent,
  ChannelDeletedEvent,
  ChannelArchiveEvent,
  ChannelUnarchiveEvent,
  ChannelIdChangedEvent,
  ChannelPurposeEvent,
  ChannelTopicEvent,
  ChannelConvertToPrivateEvent,
  ChannelConvertToPublicEvent,
  UrlVerificationEvent,
  UnknownEvent,
} from "mnemosyne-slack-shared";
import {
  verifySlackSignature,
  whitelistFileMetadata,
  capArray,
  getMessageItemId,
  getChannelItemId,
  getThreadParent,
  getMessageChannelId,
  getChannelEventChannelId,
} from "mnemosyne-slack-shared";
import { loadConfig, getSigningSecret } from "./config";
import { putItem, updateItem, getLatestItem } from "./dynamodb";
import { parseEvent } from "./events";

// Load config at module initialization
let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig();
} catch (error) {
  console.error("Failed to load configuration:", error);
  throw error;
}

/**
 * Handle URL verification challenge from Slack
 */
function handleUrlVerification(
  event: UrlVerificationEvent
): LambdaFunctionURLResponse {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge: event.challenge }),
  };
}

/**
 * Build a message item from a message event
 */
function buildMessageItem(
  event: MessageEvent,
  teamId: string,
  channelId: string
): MessageItem {
  const itemId = getMessageItemId(teamId, channelId);
  const timestamp = event.ts;

  const item: MessageItem = {
    itemId,
    timestamp,
    type: "message",
    team_id: teamId,
    channel_id: channelId,
    ts: timestamp,
    raw_event: event as unknown as SlackEvent,
  };

  if (event.text) item.text = event.text;
  if (event.user) item.user = event.user;
  
  // Thread logic: set parent if thread_ts is present (including when thread_ts === ts for parent messages)
  if (event.thread_ts) {
    item.thread_ts = event.thread_ts;
    item.parent = getThreadParent(teamId, event.thread_ts);
  }
  
  if (event.files?.length) {
    item.files = event.files.map(whitelistFileMetadata);
  }

  return item;
}

/**
 * Handle message event (new message)
 */
async function handleMessage(
  event: MessageEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  if (event.subtype === "channel_join" || event.subtype === "channel_leave") {
    return;
  }

  const item = buildMessageItem(event, teamId, channelId);
  await putItem(config.tableName, item);
  console.log(`Stored message: ${item.itemId}, timestamp: ${item.timestamp}`);
}

/**
 * Handle message_changed event (edit)
 */
async function handleMessageChanged(
  event: MessageChangedEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const message = event.message;
  if (!message.ts) {
    throw new Error("Invalid message_changed event: missing message.ts");
  }

  const itemId = getMessageItemId(teamId, channelId);
  const timestamp = message.ts;
  const updatedTs = event.edited?.ts || event.event_ts || new Date().toISOString();

  const updateExpression = `SET text = :text, raw_event = :raw_event, updated_ts = :updated_ts${message.user ? ", user = :user" : ""}`;
  const values: Record<string, unknown> = {
    ":text": message.text || "",
    ":raw_event": event as SlackEvent,
    ":updated_ts": updatedTs,
  };
  if (message.user) values[":user"] = message.user;

  try {
    await updateItem(config.tableName, { itemId, timestamp }, updateExpression, values);
    console.log(`Updated message: ${itemId}, timestamp: ${timestamp}`);
  } catch (error) {
    // Upsert: create if missing
    const awsError = error as { code?: string };
    if (awsError.code === "ValidationException" || awsError.code === "ResourceNotFoundException") {
      const item = buildMessageItem(
        { ...event, ts: timestamp, channel: channelId } as MessageEvent,
        teamId,
        channelId
      );
      item.updated_ts = updatedTs;
      await putItem(config.tableName, item);
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
  event: MessageDeletedEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const itemId = getMessageItemId(teamId, channelId);
  await updateItem(config.tableName, { itemId, timestamp: event.deleted_ts }, "SET deleted = :true", { ":true": true });
  console.log(`Marked message as deleted: ${itemId}, timestamp: ${event.deleted_ts}`);
}

/**
 * Update a channel item by getting the latest item and applying an update expression
 */
async function updateChannelItem(
  teamId: string,
  channelId: string,
  updateExpression: string,
  expressionAttributeValues: Record<string, unknown>,
  eventTs?: string
): Promise<void> {
  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = eventTs || String(Date.now() / 1000);
  const currentChannel = await getLatestItem<ChannelItem>(config.tableName, itemId);
  const updateTimestamp = currentChannel?.timestamp || timestamp;

  await updateItem(
    config.tableName,
    { itemId, timestamp: updateTimestamp },
    updateExpression,
    expressionAttributeValues
  );
}

/**
 * Handle channel_created event
 */
async function handleChannelCreated(
  event: ChannelCreatedEvent,
  teamId: string
): Promise<void> {
  const channelId = event.channel.id;
  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);
  const name = event.channel.name;

  await putItem(config.tableName, {
    itemId,
    timestamp,
    type: "channel",
    team_id: teamId,
    channel_id: channelId,
    name,
    names_history: [name],
    visibility: event.channel.is_private ? "private" : "public",
    raw_event: event as unknown as SlackEvent,
  });

  console.log(`Created channel: ${itemId}, name: ${name}`);
}

/**
 * Handle channel_rename event
 */
async function handleChannelRename(
  event: ChannelRenameEvent,
  teamId: string
): Promise<void> {
  const channelId = event.channel.id;
  const itemId = getChannelItemId(teamId, channelId);
  const newName = event.channel.name;
  const currentChannel = await getLatestItem<ChannelItem>(config.tableName, itemId);

  if (!currentChannel) {
    await putItem(config.tableName, { itemId, timestamp: event.event_ts || String(Date.now() / 1000), type: "channel", team_id: teamId, channel_id: channelId, name: newName, names_history: [newName], visibility: "public", raw_event: event as unknown as SlackEvent });
  } else {
    // Build names_history: start with existing history or current name, add new name if different
    const existingHistory = currentChannel.names_history || [currentChannel.name || channelId];
    const namesToAdd = existingHistory[existingHistory.length - 1] !== newName ? [newName] : [];
    const namesHistory = capArray([...existingHistory, ...namesToAdd], 20);
    
    await updateChannelItem(teamId, channelId, "SET name = :name, names_history = :names_history, raw_event = :raw_event", {
      ":name": newName,
      ":names_history": namesHistory,
      ":raw_event": event as unknown as SlackEvent,
    }, event.event_ts);
  }
  console.log(`Renamed channel: ${itemId}, new name: ${newName}`);
}

/**
 * Handle channel_deleted event
 */
async function handleChannelDeleted(
  event: ChannelDeletedEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  await updateChannelItem(
    teamId,
    channelId,
    "SET deleted = :true, raw_event = :raw_event",
    { ":true": true, ":raw_event": event as unknown as SlackEvent },
    event.event_ts
  );
  console.log(`Marked channel as deleted: ${getChannelItemId(teamId, channelId)}`);
}

/**
 * Handle channel_archive event
 */
async function handleChannelArchive(
  event: ChannelArchiveEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  await updateChannelItem(
    teamId,
    channelId,
    "SET archived = :true, raw_event = :raw_event",
    { ":true": true, ":raw_event": event as unknown as SlackEvent },
    event.event_ts
  );
  console.log(`Archived channel: ${getChannelItemId(teamId, channelId)}`);
}

/**
 * Handle channel_unarchive event
 */
async function handleChannelUnarchive(
  event: ChannelUnarchiveEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  await updateChannelItem(
    teamId,
    channelId,
    "REMOVE archived, SET raw_event = :raw_event",
    { ":raw_event": event as unknown as SlackEvent },
    event.event_ts
  );
  console.log(`Unarchived channel: ${getChannelItemId(teamId, channelId)}`);
}

/**
 * Handle channel_id_changed event
 */
async function handleChannelIdChanged(
  event: ChannelIdChangedEvent,
  teamId: string,
  oldChannelId: string,
  newChannelId: string
): Promise<void> {
  // Get old channel item
  const oldItemId = getChannelItemId(teamId, oldChannelId);
  const oldChannel = await getLatestItem<ChannelItem>(config.tableName, oldItemId);

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
    raw_event: event as unknown as SlackEvent,
  };

  if (oldChannel?.purpose) {
    item.purpose = oldChannel.purpose;
  }
  if (oldChannel?.topic) {
    item.topic = oldChannel.topic;
  }

  await putItem(config.tableName, item);

  console.log(`Channel ID changed: ${oldChannelId} -> ${newChannelId}`);
}

/**
 * Handle channel_purpose or channel_topic event
 */
async function handleChannelPurposeOrTopic(
  event: ChannelPurposeEvent | ChannelTopicEvent,
  teamId: string,
  channelId: string,
  field: "purpose" | "topic"
): Promise<void> {
  const value = field === "purpose" 
    ? (event.type === "channel_purpose" ? event.purpose : undefined) || ""
    : (event.type === "channel_topic" ? event.topic : undefined) || "";
  await updateChannelItem(
    teamId,
    channelId,
    `SET ${field} = :value, raw_event = :raw_event`,
    { ":value": value, ":raw_event": event as unknown as SlackEvent },
    event.event_ts
  );
  console.log(`Updated channel ${field}: ${getChannelItemId(teamId, channelId)}`);
}

/**
 * Handle channel_convert_to_private or channel_convert_to_public event
 */
async function handleChannelVisibilityChange(
  event: ChannelConvertToPrivateEvent | ChannelConvertToPublicEvent,
  teamId: string,
  channelId: string,
  visibility: "private" | "public"
): Promise<void> {
  await updateChannelItem(
    teamId,
    channelId,
    "SET visibility = :visibility, raw_event = :raw_event",
    { ":visibility": visibility, ":raw_event": event as unknown as SlackEvent },
    event.event_ts
  );
  console.log(`Changed channel visibility: ${getChannelItemId(teamId, channelId)}, visibility: ${visibility}`);
}

/**
 * Route event to appropriate handler using discriminated union narrowing
 */
async function routeEvent(event: StrictSlackEvent): Promise<void> {
  // URL verification should be handled before routing
  if (event.type === "url_verification") {
    throw new Error("URL verification should be handled before routing");
  }

  // Handle unknown events
  if (event.type === "unknown" || !("team_id" in event)) {
    console.log(`Unknown event type: ${event.type}, ignoring`);
    return;
  }

  // Type guard: ensure team_id is a string
  const teamId = typeof event.team_id === "string" ? event.team_id : "";
  if (!teamId) {
    console.log(`Event missing valid team_id, ignoring`);
    return;
  }

  // Handle message events - TypeScript narrows based on discriminated union
  if (event.type === "message" && "ts" in event) {
    // Type guard: check if it's a valid message event (not UnknownEvent)
    if (("channel" in event || "channel_id" in event) && "team_id" in event) {
      const messageEvent = event as MessageEvent | MessageChangedEvent | MessageDeletedEvent;
      const extractedChannelId = getMessageChannelId(messageEvent);
      if (!extractedChannelId || typeof extractedChannelId !== "string") {
        console.warn("Message event missing channel_id, skipping");
        return;
      }
      const channelId: string = extractedChannelId;

      // Narrow by subtype
      if ("subtype" in messageEvent && messageEvent.subtype === "message_changed" && "message" in messageEvent) {
        await handleMessageChanged(messageEvent as MessageChangedEvent, teamId, channelId);
      } else if ("subtype" in messageEvent && messageEvent.subtype === "message_deleted" && "deleted_ts" in messageEvent) {
        await handleMessageDeleted(messageEvent as MessageDeletedEvent, teamId, channelId);
      } else if ("ts" in messageEvent && typeof messageEvent.ts === "string") {
        await handleMessage(messageEvent as MessageEvent, teamId, channelId);
      }
    }
    return;
  }

  // Handle channel events - TypeScript exhaustively narrows based on discriminated union
  // All known channel event types are handled explicitly
  if (event.type !== "unknown") {
    switch (event.type) {
      case "channel_created": {
        const channelEvent = event as ChannelCreatedEvent;
        if ("channel" in channelEvent && typeof channelEvent.channel === "object" && "id" in channelEvent.channel) {
          await handleChannelCreated(channelEvent, teamId);
        }
        return;
      }

      case "channel_rename": {
        const channelEvent = event as ChannelRenameEvent;
        if ("channel" in channelEvent && typeof channelEvent.channel === "object" && "id" in channelEvent.channel) {
          await handleChannelRename(channelEvent, teamId);
        }
        return;
      }

      case "channel_deleted": {
        const channelEvent = event as ChannelDeletedEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await handleChannelDeleted(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_archive": {
        const channelEvent = event as ChannelArchiveEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId && "user" in channelEvent) {
          await handleChannelArchive(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_unarchive": {
        const channelEvent = event as ChannelUnarchiveEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId && "user" in channelEvent) {
          await handleChannelUnarchive(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_id_changed": {
        const channelEvent = event as ChannelIdChangedEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          const oldChannelId = channelEvent.previous_channel || channelId;
          await handleChannelIdChanged(channelEvent, teamId, oldChannelId, channelId);
        }
        return;
      }

      case "channel_purpose": {
        const channelEvent = event as ChannelPurposeEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await handleChannelPurposeOrTopic(channelEvent, teamId, channelId, "purpose");
        }
        return;
      }

      case "channel_topic": {
        const channelEvent = event as ChannelTopicEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await handleChannelPurposeOrTopic(channelEvent, teamId, channelId, "topic");
        }
        return;
      }

      case "channel_convert_to_private": {
        const channelEvent = event as ChannelConvertToPrivateEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await handleChannelVisibilityChange(channelEvent, teamId, channelId, "private");
        }
        return;
      }

      case "channel_convert_to_public": {
        const channelEvent = event as ChannelConvertToPublicEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await handleChannelVisibilityChange(channelEvent, teamId, channelId, "public");
        }
        return;
      }
    }
  }
  
  // Unknown or unhandled event type
  console.log(`Unhandled event type in router: ${(event as { type: string }).type}, ignoring`);
}

/**
 * Main Lambda handler for Function URL
 */
export const handler = async (
  request: LambdaFunctionURLRequest
): Promise<LambdaFunctionURLResponse> => {
  try {
    // Parse request body - handle base64 encoding if present
    let body = request.body || "{}";
    if (request.isBase64Encoded && body) {
      body = Buffer.from(body, "base64").toString("utf-8");
    }
    const headers = request.headers || {};

    // Parse event for URL verification check
    let parsedEvent: SlackEvent;
    try {
      parsedEvent = JSON.parse(body);
    } catch (error) {
      console.error("Invalid JSON in request body:", error);
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Bad Request: Invalid JSON" }),
      };
    }

    // Handle URL verification challenge (before signature verification)
    // According to https://docs.slack.dev/reference/events/url_verification/
    // URL verification events come with type "url_verification" and challenge field
    if (parsedEvent.type === "url_verification" && parsedEvent.challenge) {
      console.log("Handling URL verification challenge");
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: parsedEvent.challenge }),
      };
    }

    // Verify Slack signature for all other events
    const signature = headers["x-slack-signature"] || headers["X-Slack-Signature"];
    const timestamp =
      headers["x-slack-request-timestamp"] || headers["X-Slack-Request-Timestamp"];

    if (!signature || !timestamp) {
      console.error("Missing Slack signature headers");
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const signingSecret = await getSigningSecret(config);
    if (!verifySlackSignature(signingSecret, signature, timestamp, body)) {
      console.error("Invalid Slack signature");
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    // Parse event into strict type and route
    const strictEvent = parseEvent(parsedEvent);
    await routeEvent(strictEvent);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (error) {
    // Return 200 to prevent Slack retries (requirements: log errors but avoid duplicates)
    console.error("Error processing event:", error);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false }),
    };
  }
};