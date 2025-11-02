import { TOKEN_DEFAULT_TTL } from "../config/settings";
import { BaseSlackEvent, cachableElement } from "../config/types";
/**
 * In-memory cache utility for Lambda warm starts
 * 
 * Uses global scope variables to persist cache between warm invocations
 * Cache survives between Lambda invocations within the same container
 */

// Global cache storage - survives warm Lambda invocations
const globalCache: Map<string, { value: any; expiresAt?: number }> = new Map();
const DEFAULT_TTL = TOKEN_DEFAULT_TTL; //5 minutes
/**
 * Cache entry interface
 */
export interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

/**
 * Get value from cache
 */
export async function getFromCache<T>(key: string): Promise<T | null> {
  const entry = globalCache.get(key);
  if (!entry) {
    return null;
  }
  // Check expiration
  if (!entry.expiresAt || entry.expiresAt < Date.now()) {
    removeFromCache(key);
    return null;
  }

  return entry.value as T;
}

/**
 * Set value in cache
 * 
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttlSeconds - Time to live in seconds (optional) Default is 5 minutes (DEFAULT_TTL)
 */
export async function setInCache<T>(key: string, value: T, ttlSeconds?: number): Promise<T> {
  // Check if value has getTtlSeconds method and use it if ttlSeconds not provided
  if (!ttlSeconds && value && typeof value === 'object' && 'getTtlSeconds' in value && typeof (value as any).getTtlSeconds === 'function') {
    ttlSeconds = (value as any).getTtlSeconds();
  }
  const expiresAt = (ttlSeconds ? Date.now() + (ttlSeconds * 1000) : Date.now() + (DEFAULT_TTL * 1000));
  globalCache.set(key, {
    value,
    expiresAt,
  });
  return value;
}

/**
 * Remove value from cache
 */
export function removeFromCache(key: string): void {
  globalCache.delete(key);
}

/**
 * Clear all cache entries
 */
export function clearCache(): void {
  globalCache.clear();
}

/**
 * Check if key exists in cache
 */
export function hasInCache(key: string): boolean {
  const entry = globalCache.get(key);
  
  if (!entry) {
    return false;
  }

  // Check expiration
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    removeFromCache(key);
    return false;
  }

  return true;
}

/**
 * Get cache statistics (for debugging/monitoring)
 */
export function getCacheStats(): { size: number; keys: string[] } {
  // Clean expired entries first
  const now = Date.now();
  for (const [key, entry] of globalCache.entries()) {
    if (entry.expiresAt && entry.expiresAt < now) {
      globalCache.delete(key);
    }
  }

  return {
    size: globalCache.size,
    keys: Array.from(globalCache.keys()),
  };
}

