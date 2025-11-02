import { putItem, queryItems, DynamoDBKey } from 'mnemosyne-slack-shared';

/**
 * Calculate approximate item size in bytes (rough estimate for JSON)
 */
function estimateItemSize(item: any): number {
  return JSON.stringify(item).length;
}

interface ChannelIndexShard {
  itemId: string;
  timestamp: string;
  channels_map?: Record<string, string>;
}

/**
 * Get or create the latest ChannelIndex shard
 */
async function getLatestChannelIndexShard(
  tableName: string,
  teamId: string
): Promise<ChannelIndexShard | null> {
  const channelIndexItemId = `channelindex#${teamId}`;
  
  // Query for all shards (sorted by timestamp descending)
  const shards = await queryItems<ChannelIndexShard>({
    tableName,
    itemId: channelIndexItemId,
    limit: 1,
    scanIndexForward: false, // Get latest first
  });

  if (shards.length > 0) {
    return shards[0];
  }

  // No shard exists, create the first one
  const firstShard: ChannelIndexShard = {
    itemId: channelIndexItemId,
    timestamp: '0',
    channels_map: {},
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
    console.warn('Channel item missing team_id, skipping ChannelIndex update');
    return;
  }

  const channelId = channelItem.channel_id;
  if (!channelId) {
    console.warn('Channel item missing channel_id, skipping ChannelIndex update');
    return;
  }

  // Get the latest ChannelIndex shard
  const shard = await getLatestChannelIndexShard(tableName, teamId);
  if (!shard) {
    console.error('Failed to get or create ChannelIndex shard');
    return;
  }

  // Determine the channel name
  let channelName: string;
  if (channelItem.deleted) {
    // Channel deleted - prefix with deleted_
    const previousName = oldChannelItem?.name || channelItem.name || 'unknown';
    channelName = `deleted_${previousName}`;
  } else {
    // Channel created or renamed - use current name
    channelName = channelItem.name || 'unknown';
  }

  // Update channels_map
  const channelsMap = shard.channels_map || {};
  channelsMap[channelId] = channelName;

  // Create updated shard item
  const updatedShard: ChannelIndexShard = {
    ...shard,
    channels_map: channelsMap,
  };

  // Check if shard is too large (350KB - DynamoDB item limit is 400KB)
  const shardSize = estimateItemSize(updatedShard);
  const maxShardSize = 350 * 1024; // 350KB

  if (shardSize > maxShardSize) {
    // Create new shard with incremented timestamp
    const currentShardNumber = parseInt(shard.timestamp, 10) || 0;
    const newShardNumber = currentShardNumber + 1;
    
    const newShard: ChannelIndexShard = {
      itemId: shard.itemId,
      timestamp: newShardNumber.toString(),
      channels_map: { [channelId]: channelName }, // Start new shard with current channel
    };

    await putItem(tableName, newShard);

    console.log(`Created new ChannelIndex shard ${newShardNumber} (previous shard was ${shardSize} bytes)`);
  } else {
    // Update existing shard
    await putItem(tableName, updatedShard);

    console.log(`Updated ChannelIndex shard with channel ${channelId} -> ${channelName}`);
  }
}

