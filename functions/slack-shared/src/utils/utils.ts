import { TOKEN_CACHE_PREFIX } from "../config/settings";

/**
 * Cap array at maximum length, keeping the most recent entries
 */
export function capArray<T>(array: T[], maxLength: number): T[] {
  if (array.length <= maxLength) {
    return array;
  }
  return array.slice(-maxLength);
}

/**
 * Generate DynamoDB itemId for messages
 */
export function getMessageItemId(teamId: string, channelId: string): string {
  return `message#${teamId}#${channelId}`;
}

/**
 * Generate DynamoDB itemId for channels
 */
export function getChannelItemId(teamId: string, channelId: string): string {
  return `channel#${teamId}#${channelId}`;
}

/**
 * Generate parent attribute for thread messages
 */
export function getThreadParent(teamId: string, threadTs: string): string {
  return `thread#${teamId}#${threadTs}`;
}

/**
 * Generate cache key for token item
 */
export function getTokenItemCacheKey(teamId: string, tableName: string): string {
  return `${TOKEN_CACHE_PREFIX}${tableName}:${teamId}`;
}

/**
 * Generate DynamoDB itemId for token item
 */
export function getTokenItemDbId(teamId: string): string {
  return `oauth#${teamId}`;
}

/**
 * Format error message consistently across the application
 * Extracts message from Error objects, otherwise converts to string
 */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
