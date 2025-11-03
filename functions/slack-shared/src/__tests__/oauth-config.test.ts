import { loadOAuthConfig, getOAuthCredentials, OAuthConfig } from '../config/oauth-config';
import * as secretsUtils from '../utils/secrets-utils';
import * as cache from '../utils/cache';
import { SECRET_CACHE_TTL } from '../config/settings';

jest.mock('../utils/secrets-utils');
jest.mock('../utils/cache');

describe('oauth-config', () => {
  const mockGetSecretValue = secretsUtils.getSecretValue as jest.Mock;
  const mockGetFromCache = cache.getFromCache as jest.Mock;
  const mockSetInCache = cache.setInCache as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SLACK_ARCHIVE_TABLE;
    delete process.env.SLACK_CLIENT_ID_ARN;
    delete process.env.SLACK_CLIENT_SECRET_ARN;
    delete process.env.AWS_REGION;
  });

  describe('loadOAuthConfig', () => {
    it('should load config from environment variables', () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_CLIENT_ID_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:client-id';
      process.env.SLACK_CLIENT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:client-secret';

      const config = loadOAuthConfig();

      expect(config.tableName).toBe('test-table');
      expect(config.clientIdArn).toBe('arn:aws:secretsmanager:us-east-1:123:secret:client-id');
      expect(config.clientSecretArn).toBe('arn:aws:secretsmanager:us-east-1:123:secret:client-secret');
      expect(config.region).toBe('eu-west-1'); // Default
    });

    it('should use AWS_REGION if set', () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_CLIENT_ID_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:client-id';
      process.env.SLACK_CLIENT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:client-secret';
      process.env.AWS_REGION = 'us-east-1';

      const config = loadOAuthConfig();

      expect(config.region).toBe('us-east-1');
    });

    it('should throw error if SLACK_ARCHIVE_TABLE is missing', () => {
      expect(() => loadOAuthConfig()).toThrow('SLACK_ARCHIVE_TABLE environment variable is required');
    });

    it('should throw error if SLACK_CLIENT_ID_ARN is missing', () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';

      expect(() => loadOAuthConfig()).toThrow('SLACK_CLIENT_ID_ARN environment variable is required');
    });

    it('should throw error if SLACK_CLIENT_SECRET_ARN is missing', () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_CLIENT_ID_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:client-id';

      expect(() => loadOAuthConfig()).toThrow('SLACK_CLIENT_SECRET_ARN environment variable is required');
    });
  });

  describe('getOAuthCredentials', () => {
    it('should return cached credentials if available', async () => {
      const cachedCredentials = { clientId: 'cached-id', clientSecret: 'cached-secret' };
      mockGetFromCache.mockResolvedValue(cachedCredentials);

      const config: OAuthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-id',
        clientSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-secret',
        region: 'us-east-1',
      };

      const result = await getOAuthCredentials(config);

      expect(result).toEqual(cachedCredentials);
      expect(mockGetFromCache).toHaveBeenCalled();
    });

    it('should fetch from Secrets Manager and cache if not cached', async () => {
      mockGetFromCache.mockResolvedValue(null);
      mockGetSecretValue
        .mockResolvedValueOnce('client-id-value')
        .mockResolvedValueOnce('client-secret-value');

      const config: OAuthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-id',
        clientSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-secret',
        region: 'us-east-1',
      };

      const result = await getOAuthCredentials(config);

      expect(result).toEqual({
        clientId: 'client-id-value',
        clientSecret: 'client-secret-value',
      });
      expect(mockGetSecretValue).toHaveBeenCalledTimes(2);
      expect(mockSetInCache).toHaveBeenCalledWith(
        expect.any(String),
        { clientId: 'client-id-value', clientSecret: 'client-secret-value' },
        SECRET_CACHE_TTL
      );
    });

    it('should throw error if clientId is missing', async () => {
      mockGetFromCache.mockResolvedValue(null);
      mockGetSecretValue
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('client-secret-value');

      const config: OAuthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-id',
        clientSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-secret',
        region: 'us-east-1',
      };

      await expect(getOAuthCredentials(config)).rejects.toThrow('Client ID not found in Secrets Manager');
    });

    it('should throw error if clientSecret is missing', async () => {
      mockGetFromCache.mockResolvedValue(null);
      mockGetSecretValue
        .mockResolvedValueOnce('client-id-value')
        .mockResolvedValueOnce('');

      const config: OAuthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-id',
        clientSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-secret',
        region: 'us-east-1',
      };

      await expect(getOAuthCredentials(config)).rejects.toThrow('Client secret not found in Secrets Manager');
    });

    it('should handle Secrets Manager errors', async () => {
      mockGetFromCache.mockResolvedValue(null);
      mockGetSecretValue.mockRejectedValue(new Error('Secrets Manager error'));

      const config: OAuthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-id',
        clientSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:client-secret',
        region: 'us-east-1',
      };

      await expect(getOAuthCredentials(config)).rejects.toThrow('Failed to retrieve OAuth credentials from Secrets Manager');
    });
  });
});

