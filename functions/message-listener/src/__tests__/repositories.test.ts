import { createMessageRepository, getMessageRepository } from '../repositories';
import { MessageEvent, EventRepository } from 'mnemosyne-slack-shared';
import * as config from '../config';

// Mock config module
jest.mock('../config', () => ({
  loadConfig: jest.fn(),
}));

describe('repositories', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createMessageRepository', () => {
    it('should create a repository with correct configuration', async () => {
      const mockConfig = {
        tableName: 'test-table',
        signingSecretArn: 'arn:test',
        region: 'us-east-1',
        defaultCacheTtl: 3600,
      };

      (config.loadConfig as jest.Mock).mockResolvedValue(mockConfig);

      const repository = await createMessageRepository();

      expect(repository).toBeInstanceOf(EventRepository);
      expect(config.loadConfig).toHaveBeenCalledTimes(1);
    });

    it('should map MessageEvent to MessageItem correctly', async () => {
      const mockConfig = {
        tableName: 'test-table',
        signingSecretArn: 'arn:test',
        region: 'us-east-1',
        defaultCacheTtl: 3600,
      };

      (config.loadConfig as jest.Mock).mockResolvedValue(mockConfig);

      const repository = await createMessageRepository();

      const event: MessageEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        channel_id: 'C123456',
        ts: '1234567890.123456',
        text: 'Hello world',
        user: 'U123456',
      };

      // EventRepository methods are private - test via save() method or mock the repository
      // For now, just verify repository was created successfully
      expect(repository).toBeDefined();
      expect((repository as any).config).toBeDefined();
      // Test via the config object directly
      const item = (repository as any).config.toItem(event);

      expect(item.itemId).toBe('message#T123456#C123456');
      expect(item.timestamp).toBe('1234567890.123456');
      expect(item.type).toBe('message');
      expect(item.team_id).toBe('T123456');
      expect(item.channel_id).toBe('C123456');
      expect(item.text).toBe('Hello world');
      expect(item.user).toBe('U123456');
      expect(item.raw_event).toEqual(event);
    });

    it('should handle message with thread_ts', async () => {
      const mockConfig = {
        tableName: 'test-table',
        signingSecretArn: 'arn:test',
        region: 'us-east-1',
        defaultCacheTtl: 3600,
      };

      (config.loadConfig as jest.Mock).mockResolvedValue(mockConfig);

      const repository = await createMessageRepository();

      const event: MessageEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
        thread_ts: '1234567890.000000',
      };

      // EventRepository methods are private - test via save() method or mock the repository
      // For now, just verify repository was created successfully
      expect(repository).toBeDefined();
      expect((repository as any).config).toBeDefined();
      // Test via the config object directly
      const item = (repository as any).config.toItem(event);

      expect(item.thread_ts).toBe('1234567890.000000');
      expect(item.parent).toBe('thread#T123456#1234567890.000000');
    });

    it('should handle message with files', async () => {
      const mockConfig = {
        tableName: 'test-table',
        signingSecretArn: 'arn:test',
        region: 'us-east-1',
        defaultCacheTtl: 3600,
      };

      (config.loadConfig as jest.Mock).mockResolvedValue(mockConfig);

      const repository = await createMessageRepository();

      const event: MessageEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
        files: [
          {
            id: 'F123456',
            name: 'test.pdf',
            mimetype: 'application/pdf',
            size: 1024,
            url_private: 'https://files.slack.com/test',
          },
        ],
      };

      // EventRepository methods are private - test via save() method or mock the repository
      // For now, just verify repository was created successfully
      expect(repository).toBeDefined();
      expect((repository as any).config).toBeDefined();
      // Test via the config object directly
      const item = (repository as any).config.toItem(event);

      expect(item.files).toBeDefined();
      expect(item.files).toHaveLength(1);
      expect(item.files[0].id).toBe('F123456');
      expect(item.files[0].name).toBe('test.pdf');
    });

    it('should generate correct cache key', async () => {
      const mockConfig = {
        tableName: 'test-table',
        signingSecretArn: 'arn:test',
        region: 'us-east-1',
        defaultCacheTtl: 3600,
      };

      (config.loadConfig as jest.Mock).mockResolvedValue(mockConfig);

      const repository = await createMessageRepository();

      const event: MessageEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
      };

      const cacheKey = (repository as any).config.getCacheKey(event);

      expect(cacheKey).toBe('message:T123456:C123456:1234567890.123456');
    });

    it('should generate correct item ID', async () => {
      const mockConfig = {
        tableName: 'test-table',
        signingSecretArn: 'arn:test',
        region: 'us-east-1',
        defaultCacheTtl: 3600,
      };

      (config.loadConfig as jest.Mock).mockResolvedValue(mockConfig);

      const repository = await createMessageRepository();

      const event: MessageEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
      };

      const itemId = (repository as any).config.getItemId(event);

      expect(itemId).toBe('message#T123456#C123456');
    });

    it('should return ts as sort key', async () => {
      const mockConfig = {
        tableName: 'test-table',
        signingSecretArn: 'arn:test',
        region: 'us-east-1',
        defaultCacheTtl: 3600,
      };

      (config.loadConfig as jest.Mock).mockResolvedValue(mockConfig);

      const repository = await createMessageRepository();

      const event: MessageEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
      };

      const sortKey = (repository as any).config.getSortKey(event);

      expect(sortKey).toBe('1234567890.123456');
    });
  });

  describe('getMessageRepository', () => {
    it('should return singleton repository instance', async () => {
      const mockConfig = {
        tableName: 'test-table',
        signingSecretArn: 'arn:test',
        region: 'us-east-1',
        defaultCacheTtl: 3600,
      };

      (config.loadConfig as jest.Mock).mockResolvedValue(mockConfig);

      const repo1 = await getMessageRepository();
      const repo2 = await getMessageRepository();

      expect(repo1).toBe(repo2);
      expect(config.loadConfig).toHaveBeenCalledTimes(1); // Only called once due to singleton
    });
  });
});

