import {
  capArray,
  getMessageItemId,
  getChannelItemId,
  getThreadParent,
  getTokenItemCacheKey,
  getTokenItemDbId,
  formatErrorMessage,
} from '../utils';

describe('utils', () => {
  describe('capArray', () => {
    it('should return array unchanged if length <= maxLength', () => {
      const arr = [1, 2, 3];
      const result = capArray(arr, 5);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should cap array at maxLength, keeping most recent', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = capArray(arr, 5);
      expect(result).toEqual([6, 7, 8, 9, 10]);
      expect(result.length).toBe(5);
    });

    it('should handle empty array', () => {
      const arr: number[] = [];
      const result = capArray(arr, 5);
      expect(result).toEqual([]);
    });

    it('should handle exact length match', () => {
      const arr = [1, 2, 3, 4, 5];
      const result = capArray(arr, 5);
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('getMessageItemId', () => {
    it('should generate message item ID', () => {
      const result = getMessageItemId('T123456', 'C123456');
      expect(result).toBe('message#T123456#C123456');
    });

    it('should handle different team and channel IDs', () => {
      const result = getMessageItemId('T789', 'C456');
      expect(result).toBe('message#T789#C456');
    });
  });

  describe('getChannelItemId', () => {
    it('should generate channel item ID', () => {
      const result = getChannelItemId('T123456', 'C123456');
      expect(result).toBe('channel#T123456#C123456');
    });

    it('should handle different team and channel IDs', () => {
      const result = getChannelItemId('T789', 'C456');
      expect(result).toBe('channel#T789#C456');
    });
  });

  describe('getThreadParent', () => {
    it('should generate thread parent ID', () => {
      const result = getThreadParent('T123456', '1234567890.123456');
      expect(result).toBe('thread#T123456#1234567890.123456');
    });

    it('should handle different team IDs and timestamps', () => {
      const result = getThreadParent('T789', '9876543210.654321');
      expect(result).toBe('thread#T789#9876543210.654321');
    });
  });

  describe('getTokenItemCacheKey', () => {
    it('should generate token cache key', () => {
      const result = getTokenItemCacheKey('T123456', 'test-table');
      expect(result).toBe('token:test-table:T123456');
    });

    it('should handle different team IDs and table names', () => {
      const result = getTokenItemCacheKey('T789', 'other-table');
      expect(result).toBe('token:other-table:T789');
    });
  });

  describe('getTokenItemDbId', () => {
    it('should generate token DB ID', () => {
      const result = getTokenItemDbId('T123456');
      expect(result).toBe('oauth#T123456');
    });

    it('should handle different team IDs', () => {
      const result = getTokenItemDbId('T789');
      expect(result).toBe('oauth#T789');
    });
  });

  describe('formatErrorMessage', () => {
    it('should extract message from Error object', () => {
      const error = new Error('Test error message');
      const result = formatErrorMessage(error);
      expect(result).toBe('Test error message');
    });

    it('should convert string to string', () => {
      const result = formatErrorMessage('String error');
      expect(result).toBe('String error');
    });

    it('should convert number to string', () => {
      const result = formatErrorMessage(123);
      expect(result).toBe('123');
    });

    it('should handle null', () => {
      const result = formatErrorMessage(null);
      expect(result).toBe('null');
    });

    it('should handle undefined', () => {
      const result = formatErrorMessage(undefined);
      expect(result).toBe('undefined');
    });

    it('should handle object', () => {
      const obj = { key: 'value' };
      const result = formatErrorMessage(obj);
      expect(result).toBe('[object Object]');
    });
  });
});

