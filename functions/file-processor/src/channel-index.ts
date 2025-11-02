import { putItem, queryItems, DynamoDBKey, logger } from 'mnemosyne-slack-shared';

/**
 * Calculate approximate item size in bytes
 * 
 * Estimates DynamoDB item size by serializing to JSON. This is a rough
 * approximation - actual DynamoDB size calculation includes attribute overhead,
 * but JSON size provides a reasonable estimate for our use case.
 * 
 * Note: DynamoDB item limit is 400KB, we shard at 350KB for safety margin.
 */
function estimateItemSize(item: any): number {
  return JSON.stringify(item).length;
}

interface ChannelIndexShard extends Record<string, unknown> {
  itemId: string;
  timestamp: string;
  channels_map?: Record<string, string>;
}

/**
 * Get or create the latest ChannelIndex shard
 * 
 * ChannelIndex is sharded by timestamp (incremented when shard exceeds 350KB).
 * This function queries for the latest shard (highest timestamp) or creates
 * the first shard (timestamp '0') if none exists.
 * 
 * @param tableName - DynamoDB table name
 * @param teamId - Slack team ID
 * @returns Latest shard or null if creation fails
 */
async function getLatestChannelIndexShard(
  tableName: string,
  teamId: string
): Promise<ChannelIndexShard | null> {
  const channelIndexItemId = `channelindex#${teamId}`;
  
  // Query for latest shard (sorted by timestamp descending, limit 1)
  // Shards are numbered: '0', '1', '2', ... (higher number = newer)
  const shards = await queryItems<ChannelIndexShard>({
    tableName,
    itemId: channelIndexItemId,
    limit: 1,
    scanIndexForward: false, // Get latest (highest timestamp) first
  });

  if (shards.length > 0) {
    return shards[0];
  }

  // No shard exists - create the first one with timestamp '0'
  // This happens on first channel creation for a team
  const firstShard: ChannelIndexShard = {
    itemId: channelIndexItemId,
    timestamp: '0', // First shard starts at '0'
    channels_map: {}, // Empty map initially
  };

  await putItem(tableName, firstShard);

  return firstShard;
}

/**
 * Maintain ChannelIndex - handle channel created, renamed, or deleted
 */
export async function maintainChannelIndex(
  tableName: string,
  channelItem: any,
  oldChannelItem?: any
): Promise<void> {
  if (!channelItem.itemId?.startsWith('channel#')) {
    return; // Not a channel item
  }

  const teamId = channelItem.team_id;
  if (!teamId) {
    logger.warn('Channel item missing team_id, skipping ChannelIndex update');
    return;
  }

  const channelId = channelItem.channel_id;
  if (!channelId) {
    logger.warn('Channel item missing channel_id, skipping ChannelIndex update');
    return;
  }

  // Get the latest ChannelIndex shard
  const shard = await getLatestChannelIndexShard(tableName, teamId);
  if (!shard) {
    logger.error('Failed to get or create ChannelIndex shard');
    return;
  }

  // Determine the channel name based on channel state
  // ChannelIndex maintains channel_id -> name mapping for efficient lookups
  // For deleted channels, we prefix name with 'deleted_' to mark them in index
  // This preserves historical name while indicating deletion status
  let channelName: string;
  if (channelItem.deleted) {
    // Channel was deleted - mark with 'deleted_' prefix
    // Use previous name from oldChannelItem if available (before deletion)
    // Falls back to current name if oldItem not available, or 'unknown' if neither
    const previousName = oldChannelItem?.name || channelItem.name || 'unknown';
    channelName = `deleted_${previousName}`;
  } else {
    // Channel created or renamed - use current name
    // Falls back to 'unknown' if name missing (shouldn't happen but defensive)
    channelName = channelItem.name || 'unknown';
  }

  // Update channels_map in the latest shard
  // channels_map: Record<channel_id, channel_name>
  const channelsMap = shard.channels_map || {};
  channelsMap[channelId] = channelName;

  // Create updated shard item with new mapping
  const updatedShard: ChannelIndexShard = {
    ...shard,
    channels_map: channelsMap,
  };

  // Check if shard exceeds size limit (350KB - DynamoDB limit is 400KB)
  // We use 350KB as safety margin to avoid hitting the hard limit
  const shardSize = estimateItemSize(updatedShard);
  const maxShardSize = 350 * 1024; // 350KB

  if (shardSize > maxShardSize) {
    // Shard is too large - create a new shard
    // Shard numbers increment: '0', '1', '2', ... (as strings for sorting)
    const currentShardNumber = parseInt(shard.timestamp, 10) || 0;
    const newShardNumber = currentShardNumber + 1;
    
    // New shard starts with just the current channel
    // Previous shards remain unchanged (all historical data preserved)
    const newShard: ChannelIndexShard = {
      itemId: shard.itemId,
      timestamp: newShardNumber.toString(),
      channels_map: { [channelId]: channelName }, // Start new shard with current channel
    };

    await putItem(tableName, newShard);

    logger.info(`Created new ChannelIndex shard ${newShardNumber} (previous shard was ${shardSize} bytes)`);
  } else {
    // Shard is within size limit - update existing shard
    await putItem(tableName, updatedShard);

    logger.debug(`Updated ChannelIndex shard with channel ${channelId} -> ${channelName}`);
  }
}

