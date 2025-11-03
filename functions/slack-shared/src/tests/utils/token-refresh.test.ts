import {
  refreshOAuthToken,
  getOAuthToken,
  updateOAuthToken,
  isTokenExpired,
  getValidBotToken,
  getFromCacheOrDbWithValidation,
  getTokenItemFromDbIfNotExpired,
  deleteToken,
} from '../../utils/token-refresh';
import * as dynamodbUtils from '../../utils/dynamodb-utils';
import * as cache from '../../utils/cache';
import * as utils from '../../utils/utils';
import { OAuthTokenItem, RefreshTokenResponse } from '../../config/types';
import { TOKEN_CACHE_PREFIX, REFRESH_CACHE_PREFIX, TOKEN_DEFAULT_TTL, TOKEN_REFRESH_BUFFER } from '../../config/settings';

jest.mock('../../utils/dynamodb-utils');
jest.mock('../../utils/cache');
jest.mock('../../utils/utils');
jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

global.fetch = jest.fn();

describe('token-refresh', () => {
  const mockGetFromCache = cache.getFromCache as jest.Mock;
  const mockSetInCache = cache.setInCache as jest.Mock;
  const mockHasInCache = cache.hasInCache as jest.Mock;
  const mockGetDynamoDb = dynamodbUtils.getDynamoDb as jest.Mock;
  const mockDynamoGetById = dynamodbUtils.dynamoGetById as jest.Mock;
  const mockDynamoDeleteItem = dynamodbUtils.dynamoDeleteItem as jest.Mock;
  const mockGetTokenItemDbId = utils.getTokenItemDbId as jest.Mock;
  const mockGetTokenItemCacheKey = utils.getTokenItemCacheKey as jest.Mock;
  const mockFetch = global.fetch as jest.Mock;

  // Helper to create test token items
  function createTokenItem(overrides: Partial<OAuthTokenItem> = {}): OAuthTokenItem {
    return {
      itemId: 'oauth#T123',
      timestamp: '1',
      bot_token: 'token',
      team_id: 'T123',
      isCachable: true,
      getTtlSeconds(): number | undefined {
        return this.ttlSeconds;
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('refreshOAuthToken', () => {
    it('should refresh OAuth token successfully', async () => {
      const mockResponse: RefreshTokenResponse = {
        ok: true,
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await refreshOAuthToken('refresh-token', 'client-id', 'client-secret');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/oauth.v2.access',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
      );
    });

    it('should throw error if response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        refreshOAuthToken('refresh-token', 'client-id', 'client-secret')
      ).rejects.toThrow('Slack OAuth API returned status 500');
    });

    it('should throw error if Slack API returns error', async () => {
      const mockResponse: RefreshTokenResponse = {
        ok: false,
        error: 'invalid_refresh_token',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await expect(
        refreshOAuthToken('refresh-token', 'client-id', 'client-secret')
      ).rejects.toThrow('Slack OAuth refresh error: invalid_refresh_token');
    });
  });

  describe('isTokenExpired', () => {
    it('should return false if token never expires (Infinity)', () => {
      const tokenItem = createTokenItem({ expires_at: Infinity });

      expect(isTokenExpired(tokenItem)).toBe(false);
    });

    it('should return false if token never expires (undefined)', () => {
      const tokenItem = createTokenItem();

      expect(isTokenExpired(tokenItem)).toBe(false);
    });

    it('should return true if token is expired', () => {
      const now = Math.floor(Date.now() / 1000);
      const tokenItem = createTokenItem({ expires_at: now - 1000 }); // Expired 1000 seconds ago

      expect(isTokenExpired(tokenItem)).toBe(true);
    });

    it('should return true if token is expiring soon (within buffer)', () => {
      const now = Math.floor(Date.now() / 1000);
      // Token expires in TOKEN_REFRESH_BUFFER - 10 seconds, so refreshThreshold = now - 10
      // Since now >= now - 10, token is considered expired (expiring soon)
      const tokenItem = createTokenItem({ expires_at: now + TOKEN_REFRESH_BUFFER - 10 });

      expect(isTokenExpired(tokenItem)).toBe(true);
    });

    it('should return false if token is not expired and not expiring soon', () => {
      const now = Math.floor(Date.now() / 1000);
      // Token must expire well beyond buffer (14400 seconds = 4 hours)
      // So we use 20000 seconds (5.5 hours) to ensure it's not expiring soon
      const tokenItem = createTokenItem({ expires_at: now + 20000 }); // Expires in 5.5 hours

      expect(isTokenExpired(tokenItem)).toBe(false);
    });

    it('should use custom buffer seconds', () => {
      const now = Math.floor(Date.now() / 1000);
      const tokenItem = createTokenItem({ expires_at: now + 100 }); // Expires in 100 seconds

      // With buffer 50: refreshThreshold = now + 100 - 50 = now + 50, so now >= now + 50 is false (not expired)
      // With buffer 150: refreshThreshold = now + 100 - 150 = now - 50, so now >= now - 50 is true (expired/expiring soon)
      expect(isTokenExpired(tokenItem, 50)).toBe(false); // Token expires in 100s, buffer is 50s, so threshold is now+50, not expired yet
      expect(isTokenExpired(tokenItem, 150)).toBe(true); // Buffer 150s > expires in 100s, so refreshThreshold = now-50, expired
    });
  });

  describe('getTokenItemFromDbIfNotExpired', () => {
    it('should return null if token not found', async () => {
      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(null);

      const result = await getTokenItemFromDbIfNotExpired('table', 'T123');

      expect(result).toBeNull();
    });

    it('should return null and delete if token is expired', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = createTokenItem({ expires_at: now - 1000 });

      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(expiredToken);

      const result = await getTokenItemFromDbIfNotExpired('table', 'T123');

      expect(result).toBeNull();
      expect(mockDynamoDeleteItem).toHaveBeenCalledWith('table', {
        itemId: 'oauth#T123',
        timestamp: '1',
      });
    });

    it('should return token if not expired', async () => {
      const now = Math.floor(Date.now() / 1000);
      // Token must expire well beyond buffer (14400 seconds = 4 hours)
      const validToken = createTokenItem({ expires_at: now + 20000 }); // 5.5 hours in future

      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(validToken);

      const result = await getTokenItemFromDbIfNotExpired('table', 'T123');

      expect(result).toEqual(validToken);
      expect(mockDynamoDeleteItem).not.toHaveBeenCalled();
    });
  });

  describe('getFromCacheOrDbWithValidation', () => {
    it('should return cached token if available', async () => {
      const tokenItem = createTokenItem();

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(tokenItem);

      const result = await getFromCacheOrDbWithValidation('T123', 'table');

      expect(result).toEqual(tokenItem);
      expect(mockGetFromCache).toHaveBeenCalledWith('cache-key');
    });

    it('should fetch from DB and cache if not in cache', async () => {
      const now = Math.floor(Date.now() / 1000);
      // Token must expire well beyond the buffer (14400 seconds = 4 hours)  
      const tokenItem = createTokenItem({ expires_at: now + 20000, ttlSeconds: 20000 });

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(null);
      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(tokenItem);

      const result = await getFromCacheOrDbWithValidation('T123', 'table');

      expect(result).toEqual(tokenItem);
      // getCacheTTL returns ttlSeconds if set (20000), otherwise TOKEN_DEFAULT_TTL
      expect(mockSetInCache).toHaveBeenCalledWith('cache-key', tokenItem, 20000);
    });

    it('should return null if token not in cache or DB', async () => {
      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(null);
      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(null);

      const result = await getFromCacheOrDbWithValidation('T123', 'table');

      expect(result).toBeNull();
      expect(mockSetInCache).not.toHaveBeenCalled();
    });
  });

  describe('getOAuthToken', () => {
    it('should return cached token', async () => {
      const tokenItem = createTokenItem();

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(tokenItem);

      const result = await getOAuthToken('table', 'T123');

      expect(result).toEqual(tokenItem);
    });

    it('should fetch from DB and cache with TTL if not cached', async () => {
      const now = Math.floor(Date.now() / 1000);
      // Token must expire well beyond buffer (14400 seconds = 4 hours) to not be considered expired
      const tokenItem = createTokenItem({ expires_at: now + 20000, ttlSeconds: 20000 });

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(null);
      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(tokenItem);

      const result = await getOAuthToken('table', 'T123');

      expect(result).toEqual(tokenItem);
      expect(mockSetInCache).toHaveBeenCalledWith('cache-key', tokenItem, 12000); // 20000 * 0.6
    });

    it('should cache with default TTL if ttlSeconds not set', async () => {
      const tokenItem = createTokenItem();

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(null);
      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(tokenItem);

      const result = await getOAuthToken('table', 'T123');

      expect(result).toEqual(tokenItem);
      expect(mockSetInCache).toHaveBeenCalledWith('cache-key', tokenItem, TOKEN_DEFAULT_TTL);
    });

    it('should return null if token not found', async () => {
      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(null);
      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(null);

      const result = await getOAuthToken('table', 'T123');

      expect(result).toBeNull();
    });
  });

  describe('updateOAuthToken', () => {
    it('should update token in DB and cache', async () => {
      const mockDb = {
        send: jest.fn().mockResolvedValue({}),
      };
      const mockPutCommand = jest.fn();

      mockGetDynamoDb.mockResolvedValue(mockDb);
      jest.doMock('@aws-sdk/lib-dynamodb', () => ({
        PutCommand: mockPutCommand,
      }));

      const tokenItem = createTokenItem();

      mockGetTokenItemCacheKey.mockReturnValue(`${TOKEN_CACHE_PREFIX}table:T123`);

      await updateOAuthToken('table', tokenItem);

      expect(mockDb.send).toHaveBeenCalled();
      expect(mockSetInCache).toHaveBeenCalledWith(
        `${TOKEN_CACHE_PREFIX}table:T123`,
        tokenItem,
        TOKEN_DEFAULT_TTL
      );
      expect(mockSetInCache).toHaveBeenCalledWith(
        `${REFRESH_CACHE_PREFIX}T123`,
        true,
        60
      );
    });
  });

  describe('deleteToken', () => {
    it('should delete token from DynamoDB', async () => {
      await deleteToken('table', 'T123');

      expect(mockDynamoDeleteItem).toHaveBeenCalledWith('table', {
        itemId: 'oauth#T123',
        timestamp: '1',
      });
    });
  });

  describe('getValidBotToken', () => {
    it('should return token if not expired', async () => {
      const now = Math.floor(Date.now() / 1000);
      // Token must expire well beyond the buffer (14400 seconds = 4 hours)
      const tokenItem = createTokenItem({ bot_token: 'valid-token', expires_at: now + 20000 }); // 5.5 hours in future

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(tokenItem);

      const result = await getValidBotToken('table', 'T123', 'client-id', 'client-secret');

      expect(result).toBe('valid-token');
    });

    it('should throw error if token not found', async () => {
      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(null);
      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(null);

      await expect(
        getValidBotToken('table', 'T123', 'client-id', 'client-secret')
      ).rejects.toThrow('No OAuth token found for team: T123');
    });

    it('should refresh token if expired', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = createTokenItem({
        bot_token: 'old-token',
        expires_at: now - 1000,
        refresh_token: 'refresh-token',
      });

      const refreshedResponse: RefreshTokenResponse = {
        ok: true,
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      };

      mockGetTokenItemCacheKey
        .mockReturnValueOnce('cache-key') // First call for getOAuthToken
        .mockReturnValueOnce(`${TOKEN_CACHE_PREFIX}table:T123`) // Second call for updateOAuthToken
        .mockReturnValue(`${REFRESH_CACHE_PREFIX}T123`); // Third call for refresh lock
      mockGetFromCache.mockResolvedValue(expiredToken);
      mockHasInCache.mockResolvedValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => refreshedResponse,
      });
      mockGetDynamoDb.mockResolvedValue({
        send: jest.fn().mockResolvedValue({}),
      });

      const result = await getValidBotToken('table', 'T123', 'client-id', 'client-secret');

      expect(result).toBe('new-token');
      expect(mockFetch).toHaveBeenCalled();
    }, 10000);

    it('should wait and retry if refresh is in progress', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = createTokenItem({
        bot_token: 'old-token',
        expires_at: now - 1000,
        refresh_token: 'refresh-token',
      });

      const refreshedToken = createTokenItem({ bot_token: 'new-token', expires_at: now + 3600 });

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache
        .mockResolvedValueOnce(expiredToken) // First call - expired
        .mockResolvedValueOnce(refreshedToken); // Retry call - refreshed
      mockHasInCache.mockResolvedValue(true); // Refresh in progress
      mockGetTokenItemDbId.mockReturnValue('oauth#T123');
      mockDynamoGetById.mockResolvedValue(refreshedToken);

      const result = await getValidBotToken('table', 'T123', 'client-id', 'client-secret');

      expect(result).toBe('new-token');
    }, 10000);

    it('should throw error if expired and no refresh token', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = createTokenItem({ bot_token: 'old-token', expires_at: now - 1000 });

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(expiredToken);

      await expect(
        getValidBotToken('table', 'T123', 'client-id', 'client-secret')
      ).rejects.toThrow('Token expired and no refresh token available for team: T123');
    });

    it('should handle refresh error and remove lock', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = createTokenItem({
        bot_token: 'old-token',
        expires_at: now - 1000,
        refresh_token: 'refresh-token',
      });

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(expiredToken);
      mockHasInCache.mockResolvedValue(false);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        getValidBotToken('table', 'T123', 'client-id', 'client-secret')
      ).rejects.toThrow();

      expect(mockSetInCache).toHaveBeenCalledWith(`${REFRESH_CACHE_PREFIX}T123`, false, 1);
    }, 10000);

    it('should throw error if refresh response has no access_token', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = createTokenItem({
        bot_token: 'old-token',
        expires_at: now - 1000,
        refresh_token: 'refresh-token',
      });

      const badResponse: RefreshTokenResponse = {
        ok: true,
      } as any;

      mockGetTokenItemCacheKey.mockReturnValue('cache-key');
      mockGetFromCache.mockResolvedValue(expiredToken);
      mockHasInCache.mockResolvedValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => badResponse,
      });

      await expect(
        getValidBotToken('table', 'T123', 'client-id', 'client-secret')
      ).rejects.toThrow('No access token in refresh response');
    }, 10000);
  });
});

