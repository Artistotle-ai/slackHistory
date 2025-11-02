import {
  MessageItem,
  MessageEvent,
  MessageChangedEvent,
  MessageDeletedEvent,
  SlackEvent,
  logger,
} from "mnemosyne-slack-shared";
import {
  getMessageItemId,
  getThreadParent,
  whitelistFileMetadata,
} from "mnemosyne-slack-shared";
import { putItem, updateItem } from "../dynamodb";
import { getMessageRepository } from "../repositories";

const tableName = process.env.SLACK_ARCHIVE_TABLE!;
const messageRepo = getMessageRepository();

/**
 * Build a message item from a message event
 */
export function buildMessageItem(
  event: Pick<MessageEvent, "ts" | "text" | "user" | "thread_ts" | "files"> & { raw_event?: SlackEvent; [key: string]: any },
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
 * 
 * Example using EventRepository pattern
 */
export async function handleMessage(
  event: MessageEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  if (event.subtype === "channel_join" || event.subtype === "channel_leave") {
    return;
  }

  // Using the traditional approach (for now, can be refactored)
  const item = buildMessageItem(event, teamId, channelId);
  await putItem(tableName, item);
  logger.info(`Stored message: ${item.itemId}, timestamp: ${item.timestamp}`);
  
  // TODO: Refactor to use repository pattern:
  // const eventWithContext = { ...event, team_id: teamId, channel_id: channelId };
  // await messageRepo.save(eventWithContext);
}

/**
 * Handle message_changed event (edit)
 */
export async function handleMessageChanged(
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
  
  // Use edited timestamp if available, otherwise event timestamp, otherwise current time
  // This ensures we always have a valid timestamp for tracking when the edit occurred
  const updatedTs = event.edited?.ts || event.event_ts || new Date().toISOString();

  // Dynamically build update expression - include user only if present in edited message
  // Some edits don't include user (e.g., bot edits), so we only update if provided
  const updateExpression = `SET text = :text, raw_event = :raw_event, updated_ts = :updated_ts${message.user ? ", user = :user" : ""}`;
  const values: Record<string, unknown> = {
    ":text": message.text || "", // Empty string if text was removed
    ":raw_event": event as SlackEvent, // Store full event for debugging/audit
    ":updated_ts": updatedTs,
  };
  if (message.user) values[":user"] = message.user;

  try {
    // Attempt to update existing message
    await updateItem(tableName, { itemId, timestamp }, updateExpression, values);
    logger.info(`Updated message: ${itemId}, timestamp: ${timestamp}`);
  } catch (error) {
    // Upsert pattern: if message doesn't exist, create it instead of failing
    // This handles race conditions where edit arrives before original message
    // Also handles cases where original message was never stored (edge case)
    const awsError = error as { code?: string };
    if (awsError.code === "ValidationException" || awsError.code === "ResourceNotFoundException") {
      // Message doesn't exist - create it with edit information
      // This is idempotent-safe since we use the original message timestamp
      const item = buildMessageItem(
        { ...event, ts: timestamp, channel: channelId },
        teamId,
        channelId
      );
      item.updated_ts = updatedTs; // Mark that this was an edited message
      await putItem(tableName, item);
      logger.info(`Created missing message item: ${itemId}, timestamp: ${timestamp}`);
    } else {
      // Re-throw unexpected errors (e.g., permission errors, throttling)
      throw error;
    }
  }
}

/**
 * Handle message_deleted event
 */
export async function handleMessageDeleted(
  event: MessageDeletedEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  const itemId = getMessageItemId(teamId, channelId);
  await updateItem(
    tableName,
    { itemId, timestamp: event.deleted_ts },
    "SET deleted = :true",
    { ":true": true }
  );
  logger.info(`Marked message as deleted: ${itemId}, timestamp: ${event.deleted_ts}`);
}

