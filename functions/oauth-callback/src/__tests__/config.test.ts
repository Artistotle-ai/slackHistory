import { loadConfig, getOAuthCredentials } from '../config';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  getSecretValue: jest.fn(),
  getFromCache: jest.fn(),
  setInCache: jest.fn(),
  formatErrorMessage: jest.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
  SECRET_CACHE_TTL: 3600,
}));

describe('config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SLACK_ARCHIVE_TABLE;
    delete process.env.SLACK_CLIENT_ID_ARN;
    delete process.env.SLACK_CLIENT_SECRET_ARN;
    delete process.env.AWS_REGION;
    delete process.env.REDIRECT_URI;
    (shared.getFromCache as jest.Mock).mockReturnValue(null);
  });

  describe('loadConfig', () => {
    it('should load config from environment variables', () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_CLIENT_ID_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-id';
      process.env.SLACK_CLIENT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-secret';
      process.env.AWS_REGION = 'us-east-1';

      const config = loadConfig();

      expect(config.tableName).toBe('test-table');
      expect(config.clientIdArn).toBe('arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-id');
      expect(config.clientSecretArn).toBe('arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-secret');
      expect(config.region).toBe('us-east-1');
    });

    it('should use default region if AWS_REGION not set', () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_CLIENT_ID_ARN = 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:test/client-id';
      process.env.SLACK_CLIENT_SECRET_ARN = 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:test/client-secret';

      const config = loadConfig();

      expect(config.region).toBe('eu-west-1');
    });

    it('should throw error if SLACK_ARCHIVE_TABLE is missing', () => {
      process.env.SLACK_CLIENT_ID_ARN = 'arn:test';
      process.env.SLACK_CLIENT_SECRET_ARN = 'arn:test';

      expect(() => loadConfig()).toThrow('SLACK_ARCHIVE_TABLE environment variable is required');
    });

    it('should throw error if SLACK_CLIENT_ID_ARN is missing', () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_CLIENT_SECRET_ARN = 'arn:test';

      expect(() => loadConfig()).toThrow('SLACK_CLIENT_ID_ARN environment variable is required');
    });

    it('should throw error if SLACK_CLIENT_SECRET_ARN is missing', () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_CLIENT_ID_ARN = 'arn:test';

      expect(() => loadConfig()).toThrow('SLACK_CLIENT_SECRET_ARN environment variable is required');
    });
  });

  describe('getOAuthCredentials', () => {
    const mockConfig = {
      tableName: 'test-table',
      clientIdArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-id',
      clientSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-secret',
      region: 'us-east-1',
    };

    it('should return cached credentials if available', async () => {
      const cachedCredentials = {
        clientId: 'cached-client-id',
        clientSecret: 'cached-client-secret',
      };

      (shared.getFromCache as jest.Mock).mockReturnValue(cachedCredentials);

      const credentials = await getOAuthCredentials(mockConfig);

      expect(credentials).toEqual(cachedCredentials);
      expect(shared.getSecretValue).not.toHaveBeenCalled();
      expect(shared.setInCache).not.toHaveBeenCalled();
    });

    it('should fetch credentials from Secrets Manager if not cached', async () => {
      (shared.getFromCache as jest.Mock).mockReturnValue(null);
      (shared.getSecretValue as jest.Mock)
        .mockResolvedValueOnce('client-id-123')
        .mockResolvedValueOnce('client-secret-456');

      const credentials = await getOAuthCredentials(mockConfig);

      expect(credentials).toEqual({
        clientId: 'client-id-123',
        clientSecret: 'client-secret-456',
      });
      expect(shared.getSecretValue).toHaveBeenCalledTimes(2);
      expect(shared.setInCache).toHaveBeenCalledWith(
        'oauth_credentials',
        credentials,
        3600
      );
    });

    it('should throw error if client ID is missing', async () => {
      (shared.getFromCache as jest.Mock).mockReturnValue(null);
      (shared.getSecretValue as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('client-secret-456');

      await expect(getOAuthCredentials(mockConfig)).rejects.toThrow(
        'Client ID not found in Secrets Manager: arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-id'
      );
    });

    it('should throw error if client secret is missing', async () => {
      (shared.getFromCache as jest.Mock).mockReturnValue(null);
      (shared.getSecretValue as jest.Mock)
        .mockResolvedValueOnce('client-id-123')
        .mockResolvedValueOnce(null);

      await expect(getOAuthCredentials(mockConfig)).rejects.toThrow(
        'Client secret not found in Secrets Manager: arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-secret'
      );
    });

    it('should handle Secrets Manager errors', async () => {
      (shared.getFromCache as jest.Mock).mockReturnValue(null);
      const secretsError = new Error('Secrets Manager error');
      (shared.getSecretValue as jest.Mock).mockRejectedValue(secretsError);

      await expect(getOAuthCredentials(mockConfig)).rejects.toThrow(
        'Failed to retrieve OAuth credentials from Secrets Manager: Secrets Manager error'
      );
    });
  });
});

