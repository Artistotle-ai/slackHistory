import { loadConfig } from '../config';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  loadOAuthConfig: jest.fn(),
}));

describe('config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SLACK_FILES_BUCKET;
  });

  describe('loadConfig', () => {
    it('should load config from environment variables', () => {
      const mockOAuthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-id',
        clientSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test/client-secret',
        region: 'us-east-1',
      };

      (shared.loadOAuthConfig as jest.Mock).mockReturnValue(mockOAuthConfig);
      process.env.SLACK_FILES_BUCKET = 'test-bucket';

      const config = loadConfig();

      expect(config.oauthConfig).toEqual(mockOAuthConfig);
      expect(config.bucketName).toBe('test-bucket');
      expect(shared.loadOAuthConfig).toHaveBeenCalledTimes(1);
    });

    it('should throw error if SLACK_FILES_BUCKET is missing', () => {
      const mockOAuthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      };

      (shared.loadOAuthConfig as jest.Mock).mockReturnValue(mockOAuthConfig);

      expect(() => loadConfig()).toThrow('SLACK_FILES_BUCKET environment variable is required');
    });

    it('should throw error if SLACK_FILES_BUCKET is empty string', () => {
      const mockOAuthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      };

      (shared.loadOAuthConfig as jest.Mock).mockReturnValue(mockOAuthConfig);
      process.env.SLACK_FILES_BUCKET = '';

      expect(() => loadConfig()).toThrow('SLACK_FILES_BUCKET environment variable is required');
    });

    it('should propagate errors from loadOAuthConfig', () => {
      const error = new Error('OAuth config error');
      (shared.loadOAuthConfig as jest.Mock).mockImplementation(() => {
        throw error;
      });

      process.env.SLACK_FILES_BUCKET = 'test-bucket';

      expect(() => loadConfig()).toThrow('OAuth config error');
    });
  });
});

