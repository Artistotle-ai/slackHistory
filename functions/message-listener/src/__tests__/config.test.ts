import { loadConfig, getSigningSecret } from '../config';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  TOKEN_DEFAULT_TTL: 3600,
  getSecretValue: jest.fn(),
  getFromCache: jest.fn(),
  hasInCache: jest.fn(),
  formatErrorMessage: jest.fn((error: unknown) => 
    error instanceof Error ? error.message : String(error)
  ),
}));

describe('config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SLACK_ARCHIVE_TABLE;
    delete process.env.SLACK_SIGNING_SECRET_ARN;
    delete process.env.AWS_REGION;
  });

  describe('loadConfig', () => {
    it('should load config from environment variables', async () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_SIGNING_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';
      process.env.AWS_REGION = 'us-east-1';

      (shared.hasInCache as jest.Mock).mockResolvedValue(false);

      const config = await loadConfig();

      expect(config.tableName).toBe('test-table');
      expect(config.signingSecretArn).toBe('arn:aws:secretsmanager:us-east-1:123456789012:secret:test');
      expect(config.region).toBe('us-east-1');
      expect(config.defaultCacheTtl).toBe(3600);
    });

    it('should use default region if AWS_REGION not set', async () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';
      process.env.SLACK_SIGNING_SECRET_ARN = 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:test';

      (shared.hasInCache as jest.Mock).mockResolvedValue(false);

      const config = await loadConfig();

      expect(config.region).toBe('eu-west-1');
    });

    it('should return cached config if available', async () => {
      const cachedConfig = {
        defaultCacheTtl: 3600,
        tableName: 'cached-table',
        signingSecretArn: 'arn:cached',
        region: 'us-east-1',
      };

      (shared.hasInCache as jest.Mock).mockResolvedValue(true);
      (shared.getFromCache as jest.Mock).mockResolvedValue(cachedConfig);

      const config = await loadConfig();

      expect(config).toEqual(cachedConfig);
      expect(shared.hasInCache).toHaveBeenCalledWith('config#loadConfig');
    });

    it('should throw error if SLACK_ARCHIVE_TABLE is missing', async () => {
      process.env.SLACK_SIGNING_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';

      (shared.hasInCache as jest.Mock).mockResolvedValue(false);

      await expect(loadConfig()).rejects.toThrow('SLACK_ARCHIVE_TABLE environment variable is required');
    });

    it('should throw error if SLACK_SIGNING_SECRET_ARN is missing', async () => {
      process.env.SLACK_ARCHIVE_TABLE = 'test-table';

      (shared.hasInCache as jest.Mock).mockResolvedValue(false);

      await expect(loadConfig()).rejects.toThrow('SLACK_SIGNING_SECRET_ARN environment variable is required');
    });
  });

  describe('getSigningSecret', () => {
    it('should get signing secret from Secrets Manager', async () => {
      const config = {
        defaultCacheTtl: 3600,
        tableName: 'test-table',
        signingSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',
        region: 'us-east-1',
      };

      (shared.getSecretValue as jest.Mock).mockResolvedValue('test-secret-value');

      const secret = await getSigningSecret(config);

      expect(secret).toBe('test-secret-value');
      expect(shared.getSecretValue).toHaveBeenCalledWith(
        'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',
        'us-east-1'
      );
    });

    it('should throw error if Secrets Manager call fails', async () => {
      const config = {
        defaultCacheTtl: 3600,
        tableName: 'test-table',
        signingSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',
        region: 'us-east-1',
      };

      const error = new Error('Secrets Manager error');
      (shared.getSecretValue as jest.Mock).mockRejectedValue(error);

      await expect(getSigningSecret(config)).rejects.toThrow(
        'Failed to retrieve signing secret from Secrets Manager: Secrets Manager error'
      );
    });
  });
});

