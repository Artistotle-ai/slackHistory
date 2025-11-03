import {
  getFromCache,
  setInCache,
  removeFromCache,
  clearCache,
  hasInCache,
  getCacheStats,
} from '../utils/cache';

describe('cache', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('setInCache and getFromCache', () => {
    it('should set and get value from cache', async () => {
      await setInCache('test-key', 'test-value', 60);
      const value = await getFromCache<string>('test-key');
      expect(value).toBe('test-value');
    });

    it('should return null for non-existent key', async () => {
      const value = await getFromCache<string>('non-existent');
      expect(value).toBeNull();
    });

    it('should expire entries after TTL', async () => {
      // Set with 0.1 second TTL
      await setInCache('expiring-key', 'value', 0.1);
      
      // Should be available immediately
      expect(await getFromCache<string>('expiring-key')).toBe('value');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should be expired
      expect(await getFromCache<string>('expiring-key')).toBeNull();
    });

    it('should use default TTL if not provided', async () => {
      await setInCache('default-ttl-key', 'value');
      const value = await getFromCache<string>('default-ttl-key');
      expect(value).toBe('value');
    });

    it('should handle object values', async () => {
      const obj = { key: 'value', number: 123 };
      await setInCache('object-key', obj, 60);
      const cached = await getFromCache<typeof obj>('object-key');
      expect(cached).toEqual(obj);
    });

    it('should handle values with getTtlSeconds method', async () => {
      const valueWithTtl = {
        data: 'test',
        getTtlSeconds: () => 60,
      };
      await setInCache('ttl-method-key', valueWithTtl);
      const cached = await getFromCache<typeof valueWithTtl>('ttl-method-key');
      expect(cached).toEqual(valueWithTtl);
    });
  });

  describe('hasInCache', () => {
    it('should return true for existing key', async () => {
      await setInCache('has-key', 'value', 60);
      expect(hasInCache('has-key')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(hasInCache('non-existent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      await setInCache('expired-key', 'value', 0.1);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(hasInCache('expired-key')).toBe(false);
    });
  });

  describe('removeFromCache', () => {
    it('should remove key from cache', async () => {
      await setInCache('remove-key', 'value', 60);
      expect(hasInCache('remove-key')).toBe(true);
      
      removeFromCache('remove-key');
      
      expect(hasInCache('remove-key')).toBe(false);
      expect(await getFromCache<string>('remove-key')).toBeNull();
    });

    it('should handle removing non-existent key', () => {
      expect(() => removeFromCache('non-existent')).not.toThrow();
    });
  });

  describe('clearCache', () => {
    it('should clear all cache entries', async () => {
      await setInCache('key1', 'value1', 60);
      await setInCache('key2', 'value2', 60);
      
      expect(hasInCache('key1')).toBe(true);
      expect(hasInCache('key2')).toBe(true);
      
      clearCache();
      
      expect(hasInCache('key1')).toBe(false);
      expect(hasInCache('key2')).toBe(false);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      await setInCache('key1', 'value1', 60);
      await setInCache('key2', 'value2', 60);
      
      const stats = getCacheStats();
      
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
    });

    it('should clean expired entries', async () => {
      await setInCache('expired', 'value', 0.1);
      await setInCache('valid', 'value', 60);
      
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const stats = getCacheStats();
      
      expect(stats.size).toBe(1);
      expect(stats.keys).toContain('valid');
      expect(stats.keys).not.toContain('expired');
    });

    it('should return empty stats for empty cache', () => {
      const stats = getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    });
  });
});

