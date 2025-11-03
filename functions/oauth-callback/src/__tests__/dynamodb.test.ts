import { storeOAuthTokens } from '../dynamodb';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  putItem: jest.fn(),
}));

describe('dynamodb', () => {
  const mockPutItem = shared.putItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPutItem.mockResolvedValue(undefined);
  });

  describe('storeOAuthTokens', () => {
    it('should store OAuth tokens in DynamoDB', async () => {
      const tableName = 'test-table';
      const tokenItem = {
        itemId: 'oauth#T123',
        timestamp: '1',
        bot_token: 'xoxb-token-123',
        refresh_token: 'xoxe-token-456',
        expires_at: 1234567890,
        scope: 'channels:read,chat:write',
        bot_user_id: 'U123456',
        team_id: 'T123',
        team_name: 'Test Team',
        ttlSeconds: 3600,
        isCachable: true as const,
        getTtlSeconds: () => 3600,
      };

      await storeOAuthTokens(tableName, tokenItem);

      expect(mockPutItem).toHaveBeenCalledWith(tableName, tokenItem);
    });

    it('should handle DynamoDB write errors', async () => {
      const tableName = 'test-table';
      const tokenItem = {
        itemId: 'oauth#T123',
        timestamp: '1',
        bot_token: 'xoxb-token-123',
        team_id: 'T123',
        isCachable: true as const,
        getTtlSeconds: () => undefined,
      };

      const dynamoError = new Error('DynamoDB write failed');
      mockPutItem.mockRejectedValue(dynamoError);

      await expect(storeOAuthTokens(tableName, tokenItem)).rejects.toThrow('DynamoDB write failed');
    });

    it('should store token with correct structure', async () => {
      const tableName = 'test-table';
      const tokenItem = {
        itemId: 'oauth#T123',
        timestamp: '1',
        bot_token: 'xoxb-token-123',
        refresh_token: 'xoxe-token-456',
        expires_at: 1234567890,
        scope: 'channels:read',
        bot_user_id: 'U123456',
        team_id: 'T123',
        team_name: 'Test Team',
        ttlSeconds: 3600,
        isCachable: true as const,
        getTtlSeconds: () => 3600,
      };

      await storeOAuthTokens(tableName, tokenItem);

      expect(mockPutItem).toHaveBeenCalledWith(tableName, tokenItem);
      expect(mockPutItem).toHaveBeenCalledTimes(1);
    });
  });
});

