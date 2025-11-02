import { BaseSlackEvent } from "./types";
import { putItem, updateItem, queryItems, getLatestItem } from "./utils/dynamodb-utils";
import { getFromCache, setInCache } from "./utils/cache";

/**
 * Event repository interface - defines how to transform events to DB items
 */
export interface EventRepositoryConfig<T extends BaseSlackEvent, TItem extends Record<string, unknown>> {
  /**
   * Transform event to DynamoDB item format
   */
  toItem: (event: T) => TItem;
  
  /**
   * Get cache key for an event
   */
  getCacheKey: (event: T) => string;
  
  /**
   * Extract itemId from event for DB operations
   */
  getItemId: (event: T) => string;
  
  /**
   * Extract sort key from event for DB operations
   */
  getSortKey: (event: T) => string;
  
  /**
   * Table name in DynamoDB
   */
  tableName: string;
  
  /**
   * Cache TTL in seconds (optional)
   */
  cacheTtl?: number;
}

/**
 * Generic Event Repository Pattern
 * 
 * Handles common operations for different event types:
 * - Transform events to DB items via toItem()
 * - Cache management
 * - DynamoDB operations
 * 
 * Usage:
 * ```typescript
 * const messageRepo = new EventRepository<MessageEvent, MessageItem>({
 *   toItem: (event) => ({ ... }),
 *   getCacheKey: (event) => `msg:${event.ts}`,
 *   tableName: 'MyTable',
 *   cacheTtl: 300
 * });
 * 
 * await messageRepo.save(messageEvent);
 * const cached = await messageRepo.getCached(messageEvent);
 * ```
 */
export class EventRepository<T extends BaseSlackEvent, TItem extends Record<string, unknown>> {
  constructor(private config: EventRepositoryConfig<T, TItem>) {}
  /**
   * Save event to DynamoDB (with optional cache)
   */
  async save(event: T): Promise<void> {
    const item = this.config.toItem(event);
    await putItem(this.config.tableName, item);
    
    // Optional caching
    if (this.config.cacheTtl) {
      const cacheKey = this.config.getCacheKey(event);
      setInCache(cacheKey, item, this.config.cacheTtl);
    }
  }

  /**
   * Get cached item or fetch from DB
   */
  async getCached(event: T): Promise<TItem | null> {
    const cacheKey = this.config.getCacheKey(event);
    
    // Check cache first
    const cached = getFromCache<TItem>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Fetch from DB
    const item = await this.getLatest(event);
    
    // Cache it
    if (item && this.config.cacheTtl) {
      setInCache(cacheKey, item, this.config.cacheTtl);
    }
    
    return item;
  }

  /**
   * Get latest item for an event
   */
  async getLatest(event: T): Promise<TItem | null> {
    const itemId = this.config.getItemId(event);
    return getLatestItem<TItem>(this.config.tableName, itemId);
  }

  /**
   * Update item with expression
   */
  async update(
    event: T,
    updateExpression: string,
    expressionAttributeValues: Record<string, unknown>
  ): Promise<void> {
    const itemId = this.config.getItemId(event);
    const sortKey = this.config.getSortKey(event);
    
    await updateItem(
      this.config.tableName,
      { itemId, timestamp: sortKey },
      updateExpression,
      expressionAttributeValues
    );
  }

  /**
   * Invalidate cache for an event
   */
  invalidateCache(event: T): void {
    const cacheKey = this.config.getCacheKey(event);
    // removeFromCache is available in cache.ts if needed
    // For now, just log
    console.log(`TODO: Cache invalidated for: ${cacheKey}`);
  }
}

