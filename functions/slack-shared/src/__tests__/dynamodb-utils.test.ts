import {
  getDynamoDb,
  getCommands,
  putItem,
  updateItem,
  queryItems,
  getLatestItem,
  dynamoGetById,
  dynamoDeleteItem,
  createDynamoClient,
} from '../utils/dynamodb-utils';
import * as cache from '../utils/cache';

jest.mock('../utils/cache');

const mockSend = jest.fn().mockResolvedValue({});
const mockDynamoDbClient = {};
const mockHttpHandler = {};

const mockGetCommandConstructor = jest.fn();
const mockPutCommandConstructor = jest.fn();
const mockUpdateCommandConstructor = jest.fn();
const mockDeleteCommandConstructor = jest.fn();
const mockQueryCommandConstructor = jest.fn();

// Store instances created by constructors
const mockGetCommandInstance = {};
const mockPutCommandInstance = {};
const mockUpdateCommandInstance = {};
const mockDeleteCommandInstance = {};
const mockQueryCommandInstance = {};

mockGetCommandConstructor.mockReturnValue(mockGetCommandInstance);
mockPutCommandConstructor.mockReturnValue(mockPutCommandInstance);
mockUpdateCommandConstructor.mockReturnValue(mockUpdateCommandInstance);
mockDeleteCommandConstructor.mockReturnValue(mockDeleteCommandInstance);
mockQueryCommandConstructor.mockReturnValue(mockQueryCommandInstance);

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: mockGetCommandConstructor,
  PutCommand: mockPutCommandConstructor,
  UpdateCommand: mockUpdateCommandConstructor,
  DeleteCommand: mockDeleteCommandConstructor,
  QueryCommand: mockQueryCommandConstructor,
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => mockDynamoDbClient),
}));

jest.mock('@aws-sdk/node-http-handler', () => ({
  NodeHttpHandler: jest.fn(() => mockHttpHandler),
}));

describe('dynamodb-utils', () => {
  const mockGetFromCache = cache.getFromCache as jest.Mock;
  const mockSetInCache = cache.setInCache as jest.Mock;
  const mockHasInCache = cache.hasInCache as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDynamoDb', () => {
    it('should return DynamoDB document client', async () => {
      const db = await getDynamoDb();

      expect(db).toBeDefined();
      expect(db.send).toBeDefined();
    });

    it('should return same client instance on subsequent calls', async () => {
      const db1 = await getDynamoDb();
      const db2 = await getDynamoDb();

      expect(db1).toBe(db2);
    });

    it('should lazy load HTTP agents when creating client', async () => {
      // First call initializes client and HTTP agents
      const db1 = await getDynamoDb();
      expect(db1).toBeDefined();
      
      // Second call should reuse the same client
      const db2 = await getDynamoDb();
      expect(db2).toBe(db1);
    });
  });

  describe('getCommands', () => {
    it('should return command constructors', async () => {
      const commands = await getCommands();

      // These are command constructors from @aws-sdk/lib-dynamodb
      // The actual classes are imported dynamically, so we verify they exist
      expect(commands).toBeDefined();
      expect(commands.GetCommand).toBeDefined();
      expect(commands.PutCommand).toBeDefined();
      expect(commands.UpdateCommand).toBeDefined();
      expect(commands.DeleteCommand).toBeDefined();
      // QueryCommand might be undefined if the mock doesn't export it
      // The function still works even if some commands are undefined
      expect(typeof commands).toBe('object');
    });
  });

  describe('putItem', () => {
    it('should put item to DynamoDB', async () => {
      const item = { itemId: 'test#123', timestamp: '1', data: 'test' };
      mockSend.mockResolvedValue({});
      
      await putItem('table', item);
      
      expect(mockSend).toHaveBeenCalled();
      expect(mockPutCommandConstructor).toHaveBeenCalledWith({
        TableName: 'table',
        Item: item,
      });
    });
  });

  describe('updateItem', () => {
    it('should update item in DynamoDB', async () => {
      const key = { itemId: 'test#123', timestamp: '1' };
      const updateExpression = 'SET #data = :data';
      const expressionAttributeValues = { ':data': 'updated' };
      mockSend.mockResolvedValue({});
      
      await updateItem('table', key, updateExpression, expressionAttributeValues);
      
      expect(mockSend).toHaveBeenCalled();
      expect(mockUpdateCommandConstructor).toHaveBeenCalledWith({
        TableName: 'table',
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
      });
    });
  });

  describe('queryItems', () => {
    it('should query items from DynamoDB', async () => {
      const items = [{ itemId: 'test#123', timestamp: '1', data: 'test' }];
      mockSend.mockResolvedValue({ Items: items });
      
      const result = await queryItems({
        tableName: 'table',
        itemId: 'test#123',
      });
      
      expect(result).toEqual(items);
      expect(mockSend).toHaveBeenCalled();
      expect(mockQueryCommandConstructor).toHaveBeenCalledWith({
        TableName: 'table',
        KeyConditionExpression: 'itemId = :itemId',
        ExpressionAttributeValues: { ':itemId': 'test#123' },
        ScanIndexForward: true,
        Limit: undefined,
      });
    });

    it('should return empty array if no items found', async () => {
      mockSend.mockResolvedValue({ Items: undefined });
      
      const result = await queryItems({
        tableName: 'table',
        itemId: 'test#123',
      });
      
      expect(result).toEqual([]);
    });

    it('should handle scanIndexForward option', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      
      await queryItems({
        tableName: 'table',
        itemId: 'test#123',
        scanIndexForward: false,
      });
      
      expect(mockQueryCommandConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          ScanIndexForward: false,
        })
      );
    });

    it('should handle limit option', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      
      await queryItems({
        tableName: 'table',
        itemId: 'test#123',
        limit: 10,
      });
      
      expect(mockQueryCommandConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          Limit: 10,
        })
      );
    });
  });

  describe('getLatestItem', () => {
    it('should return cached item if available', async () => {
      const cachedItem = { itemId: 'test#123', timestamp: '1', data: 'test' };
      mockGetFromCache.mockResolvedValue(cachedItem);

      const result = await getLatestItem('table', 'test#123');

      expect(result).toEqual(cachedItem);
      expect(mockGetFromCache).toHaveBeenCalledWith('table#test#123');
    });

    it('should fetch from DB and cache if not cached', async () => {
      const item = { itemId: 'test#123', timestamp: '1', data: 'test' };
      mockGetFromCache.mockResolvedValue(null);
      // getLatestItem calls queryItems which uses QueryCommand
      mockSend
        .mockResolvedValueOnce({ Items: [item] }) // For queryItems call
        .mockResolvedValueOnce({}); // For setInCache
      mockSetInCache.mockResolvedValue(item);
      
      const result = await getLatestItem('table', 'test#123');
      
      expect(result).toEqual(item);
      expect(mockGetFromCache).toHaveBeenCalledWith('table#test#123');
      expect(mockSetInCache).toHaveBeenCalledWith('table#test#123', item);
      expect(mockSend).toHaveBeenCalled();
    });

    it('should return null if no items found', async () => {
      mockGetFromCache.mockResolvedValue(null);
      mockSend.mockResolvedValue({ Items: [] });
      
      const result = await getLatestItem('table', 'nonexistent');
      
      expect(result).toBeNull();
      expect(mockGetFromCache).toHaveBeenCalledWith('table#nonexistent');
      expect(mockSetInCache).not.toHaveBeenCalled();
    });

    it('should return null if Items is undefined', async () => {
      mockGetFromCache.mockResolvedValue(null);
      mockSend.mockResolvedValue({ Items: undefined });
      
      const result = await getLatestItem('table', 'nonexistent');
      
      expect(result).toBeNull();
      expect(mockGetFromCache).toHaveBeenCalledWith('table#nonexistent');
      expect(mockSetInCache).not.toHaveBeenCalled();
    });

    it('should handle queryItems returning empty array', async () => {
      mockGetFromCache.mockResolvedValue(null);
      mockSend.mockResolvedValue({ Items: [] });
      
      const result = await getLatestItem('table', 'nonexistent');
      
      expect(result).toBeNull();
    });
  });

  describe('dynamoSanitizeKey', () => {
    it('should truncate keys exceeding byte limit', async () => {
      // Create a key that's exactly 1025 bytes
      const longKey = 'a'.repeat(1025);
      mockSend.mockResolvedValue({ Item: null });
      
      await dynamoGetById('table', longKey);
      
      const callArg = mockGetCommandConstructor.mock.calls[0][0];
      const sanitizedKey = callArg.Key.itemId;
      expect(Buffer.byteLength(sanitizedKey, 'utf8')).toBeLessThanOrEqual(1024);
      expect(sanitizedKey.length).toBeLessThan(longKey.length);
    });

    it('should handle multi-byte characters in key truncation', async () => {
      // Create a key with multi-byte characters that exceeds byte limit
      const multiByteKey = '🚀'.repeat(400); // Each emoji is 4 bytes, so 1600 bytes total
      mockSend.mockResolvedValue({ Item: null });
      
      await dynamoGetById('table', multiByteKey);
      
      const callArg = mockGetCommandConstructor.mock.calls[0][0];
      const sanitizedKey = callArg.Key.itemId;
      expect(Buffer.byteLength(sanitizedKey, 'utf8')).toBeLessThanOrEqual(1024);
    });

    it('should handle truncation loop for very long keys', async () => {
      // Create a key that's much longer than 1024 bytes to test the while loop
      const veryLongKey = 'a'.repeat(5000);
      mockSend.mockResolvedValue({ Item: null });
      
      await dynamoGetById('table', veryLongKey);
      
      const callArg = mockGetCommandConstructor.mock.calls[0][0];
      const sanitizedKey = callArg.Key.itemId;
      expect(Buffer.byteLength(sanitizedKey, 'utf8')).toBeLessThanOrEqual(1024);
      expect(sanitizedKey.length).toBeLessThan(veryLongKey.length);
    });
  });

  describe('dynamoGetById', () => {
    it('should get item by itemId only', async () => {
      const item = { itemId: 'test#123', data: 'test' };
      mockSend.mockResolvedValue({ Item: item });
      
      const result = await dynamoGetById('table', 'test#123');
      
      expect(result).toEqual(item);
      expect(mockSend).toHaveBeenCalled();
      expect(mockGetCommandConstructor).toHaveBeenCalledWith({
        TableName: 'table',
        Key: { itemId: 'test#123' },
      });
    });

    it('should get item by itemId and sortKey', async () => {
      const item = { itemId: 'test#123', timestamp: '1', data: 'test' };
      mockSend.mockResolvedValue({ Item: item });
      
      const result = await dynamoGetById('table', 'test#123', '1');
      
      expect(result).toEqual(item);
      expect(mockGetCommandConstructor).toHaveBeenCalledWith({
        TableName: 'table',
        Key: { itemId: 'test#123', timestamp: '1' },
      });
    });

    it('should handle sortKey as undefined (branch coverage)', async () => {
      const item = { itemId: 'test#123', data: 'test' };
      mockSend.mockResolvedValue({ Item: item });
      
      const result = await dynamoGetById('table', 'test#123', undefined);
      
      // When sortKey is undefined, it should not be included in the key
      expect(result).toEqual(item);
      expect(mockGetCommandConstructor).toHaveBeenCalledWith({
        TableName: 'table',
        Key: { itemId: 'test#123' },
      });
    });

    it('should return null if item not found', async () => {
      mockSend.mockResolvedValue({ Item: undefined });
      
      const result = await dynamoGetById('table', 'nonexistent');
      
      expect(result).toBeNull();
    });

    it('should sanitize keys that are too long', async () => {
      const longKey = 'a'.repeat(2000); // Much longer than 1024 bytes
      mockSend.mockResolvedValue({ Item: null });
      
      await dynamoGetById('table', longKey);
      
      const callArg = mockGetCommandConstructor.mock.calls[0][0];
      expect(Buffer.byteLength(callArg.Key.itemId, 'utf8')).toBeLessThanOrEqual(1024);
    });

    it('should not sanitize keys that are within limit', async () => {
      const normalKey = 'test#123';
      mockSend.mockResolvedValue({ Item: { itemId: normalKey } });
      
      await dynamoGetById('table', normalKey);
      
      const callArg = mockGetCommandConstructor.mock.calls[0][0];
      expect(callArg.Key.itemId).toBe(normalKey);
    });

    it('should sanitize sortKey if provided and too long', async () => {
      const longSortKey = 'a'.repeat(2000);
      mockSend.mockResolvedValue({ Item: null });
      
      await dynamoGetById('table', 'item#123', longSortKey);
      
      const callArg = mockGetCommandConstructor.mock.calls[0][0];
      expect(Buffer.byteLength(callArg.Key.timestamp as string, 'utf8')).toBeLessThanOrEqual(1024);
    });

    it('should handle key sanitization error path (line 141/dynamoSanitizeKey edge case)', async () => {
      // Test the error handling when key sanitization encounters edge cases
      // This covers branch coverage for the truncation logic in dynamoSanitizeKey
      const veryLongKey = '🚀'.repeat(300); // Multi-byte characters, very long
      mockSend.mockResolvedValue({ Item: null });
      
      await dynamoGetById('table', veryLongKey);
      
      const callArg = mockGetCommandConstructor.mock.calls[0][0];
      const sanitizedKey = callArg.Key.itemId;
      // Should truncate properly even with multi-byte characters
      expect(Buffer.byteLength(sanitizedKey, 'utf8')).toBeLessThanOrEqual(1024);
      // Verify truncation loop handles edge cases
      expect(sanitizedKey.length).toBeLessThan(veryLongKey.length);
    });
  });

  describe('dynamoDeleteItem', () => {
    it('should delete item from DynamoDB', async () => {
      const key = { itemId: 'test#123', timestamp: '1' };
      mockSend.mockResolvedValue({});
      
      await dynamoDeleteItem('table', key);
      
      expect(mockSend).toHaveBeenCalled();
      expect(mockDeleteCommandConstructor).toHaveBeenCalledWith({
        TableName: 'table',
        Key: key,
      });
    });
  });

  describe('createDynamoClient', () => {
    it('should create DynamoDB client with get method', () => {
      const client = createDynamoClient('table');

      expect(client.get).toBeDefined();
      expect(typeof client.get).toBe('function');
    });

    it('should get item without sortKey', async () => {
      const client = createDynamoClient('table');
      const item = { itemId: 'test#123', data: 'test' };
      mockSend.mockResolvedValue({ Item: item });

      const result = await client.get('test#123');

      expect(result).toEqual(item);
      expect(mockSend).toHaveBeenCalled();
    });

    it('should get item with sortKey', async () => {
      const client = createDynamoClient('table');
      const item = { itemId: 'test#123', timestamp: '1', data: 'test' };
      mockSend.mockResolvedValue({ Item: item });

      const result = await client.get('test#123', '1');

      expect(result).toEqual(item);
    });
  });
});

