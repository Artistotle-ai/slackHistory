import {
  ChannelItem,
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
  SlackEvent,
  logger,
} from "mnemosyne-slack-shared";
import {
  getChannelItemId,
  capArray,
} from "mnemosyne-slack-shared";
import { putItem, getLatestItem, updateItem } from "../dynamodb";

// NOTE: This is read at module load time, not runtime
// This means tests need to set process.env.SLACK_ARCHIVE_TABLE before importing this module
// or use jest.resetModules() to force a fresh import after setting env vars
const tableName = process.env.SLACK_ARCHIVE_TABLE!;

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
  const currentChannel = await getLatestItem<ChannelItem>(tableName, itemId);
  const updateTimestamp = currentChannel?.timestamp || timestamp;

  await updateItem(
    tableName,
    { itemId, timestamp: updateTimestamp },
    updateExpression,
    expressionAttributeValues
  );
}

/**
 * Handle channel_created event
 */
export async function handleChannelCreated(
  event: ChannelCreatedEvent,
  teamId: string
): Promise<void> {
  const channelId = event.channel.id;
  const itemId = getChannelItemId(teamId, channelId);
  const timestamp = event.event_ts || String(Date.now() / 1000);
  const name = event.channel.name;

  await putItem(tableName, {
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

  logger.info(`Created channel: ${itemId}, name: ${name}`);
}

/**
 * Handle channel_rename event
 */
export async function handleChannelRename(
  event: ChannelRenameEvent,
  teamId: string
): Promise<void> {
  const channelId = event.channel.id;
  const itemId = getChannelItemId(teamId, channelId);
  const newName = event.channel.name;
  const currentChannel = await getLatestItem<ChannelItem>(tableName, itemId);

  if (!currentChannel) {
    // Channel doesn't exist - create new entry
    // This handles race condition where rename arrives before channel_created event
    await putItem(tableName, {
      itemId,
      timestamp: event.event_ts || String(Date.now() / 1000),
      type: "channel",
      team_id: teamId,
      channel_id: channelId,
      name: newName,
      names_history: [newName], // Start history with current name
      visibility: "public", // Default to public (may be incorrect but safe default)
      raw_event: event as unknown as SlackEvent,
    });
  } else {
    // Channel exists - update name and append to history
    // Build names_history: start with existing history or current name as fallback
    // Only add new name to history if it's different from the last entry (avoid duplicates)
    const existingHistory = currentChannel.names_history || [currentChannel.name || channelId];
    const lastKnownName = existingHistory[existingHistory.length - 1];
    
    // Only append if name actually changed (avoid duplicate entries)
    const namesToAdd = lastKnownName !== newName ? [newName] : [];
    
    // Cap history at 20 entries to prevent unbounded growth
    // Keeps most recent 20 renames (oldest entries dropped)
    const namesHistory = capArray([...existingHistory, ...namesToAdd], 20);
    
    await updateChannelItem(teamId, channelId, "SET name = :name, names_history = :names_history, raw_event = :raw_event", {
      ":name": newName,
      ":names_history": namesHistory,
      ":raw_event": event as unknown as SlackEvent,
    }, event.event_ts);
  }
  logger.info(`Renamed channel: ${itemId}, new name: ${newName}`);
}

/**
 * Handle channel_deleted event
 */
export async function handleChannelDeleted(
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
  logger.info(`Marked channel as deleted: ${getChannelItemId(teamId, channelId)}`);
}

/**
 * Handle channel_archive event
 */
export async function handleChannelArchive(
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
  logger.info(`Archived channel: ${getChannelItemId(teamId, channelId)}`);
}

/**
 * Handle channel_unarchive event
 */
export async function handleChannelUnarchive(
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
  logger.info(`Unarchived channel: ${getChannelItemId(teamId, channelId)}`);
}

/**
 * Handle channel_id_changed event
 */
export async function handleChannelIdChanged(
  event: ChannelIdChangedEvent,
  teamId: string,
  oldChannelId: string,
  newChannelId: string
): Promise<void> {
  // Get old channel item
  const oldItemId = getChannelItemId(teamId, oldChannelId);
  const oldChannel = await getLatestItem<ChannelItem>(tableName, oldItemId);

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

  await putItem(tableName, item);

  logger.info(`Channel ID changed: ${oldChannelId} -> ${newChannelId}`);
}

/**
 * Handle channel_purpose or channel_topic event
 */
export async function handleChannelPurposeOrTopic(
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
  logger.info(`Updated channel ${field}: ${getChannelItemId(teamId, channelId)}`);
}

/**
 * Handle channel_convert_to_private or channel_convert_to_public event
 */
export async function handleChannelVisibilityChange(
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
  logger.info(`Changed channel visibility: ${getChannelItemId(teamId, channelId)}, visibility: ${visibility}`);
}

