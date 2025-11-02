import {
  handleMessage,
  handleMessageChanged,
  handleMessageDeleted,
  buildMessageItem,
} from '../handlers/message-handlers';
import { MessageEvent, MessageChangedEvent, MessageDeletedEvent } from 'mnemosyne-slack-shared';
import * as dynamodb from '../dynamodb';

// Set environment variable before importing handlers (handlers read it at module load)
process.env.SLACK_ARCHIVE_TABLE = 'test-table';

// Mock DynamoDB functions - must be before importing handlers
jest.mock('../dynamodb');
jest.mock('../repositories', () => ({
  getMessageRepository: jest.fn(() => ({
    save: jest.fn(),
  })),
}));

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('message-handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildMessageItem', () => {
    it('should build message item with required fields', () => {
      const event = {
        type: 'message' as const,
        ts: '1234567890.123456',
        text: 'Hello world',
        user: 'U123456',
        team_id: 'T123456',
        channel: 'C123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      const item = buildMessageItem(event, teamId, channelId);

      expect(item.itemId).toBe('message#T123456#C123456');
      expect(item.timestamp).toBe('1234567890.123456');
      expect(item.type).toBe('message');
      expect(item.team_id).toBe(teamId);
      expect(item.channel_id).toBe(channelId);
      expect(item.ts).toBe('1234567890.123456');
      expect(item.text).toBe('Hello world');
      expect(item.user).toBe('U123456');
    });

    it('should include thread_ts and parent when thread_ts is present', () => {
      const event = {
        ts: '1234567890.123456',
        thread_ts: '1234567890.000000',
        text: 'Thread reply',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      const item = buildMessageItem(event, teamId, channelId);

      expect(item.thread_ts).toBe('1234567890.000000');
      expect(item.parent).toBe('thread#T123456#1234567890.000000');
    });

    it('should include files metadata when present', () => {
      const event = {
        ts: '1234567890.123456',
        files: [
          {
            id: 'F123456',
            name: 'test.pdf',
            mimetype: 'application/pdf',
          },
        ],
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      const item = buildMessageItem(event, teamId, channelId);

      expect(item.files).toBeDefined();
      expect(item.files?.length).toBe(1);
      expect(item.files?.[0].id).toBe('F123456');
      expect(item.files?.[0].name).toBe('test.pdf');
    });

    it('should not include optional fields when absent', () => {
      const event = {
        ts: '1234567890.123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      const item = buildMessageItem(event, teamId, channelId);

      expect(item.text).toBeUndefined();
      expect(item.user).toBeUndefined();
      expect(item.thread_ts).toBeUndefined();
      expect(item.files).toBeUndefined();
    });
  });

  describe('handleMessage', () => {
    it('should store message in DynamoDB', async () => {
      const event: MessageEvent = {
        type: 'message',
        ts: '1234567890.123456',
        text: 'Hello world',
        user: 'U123456',
        channel: 'C123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      (dynamodb.putItem as jest.Mock).mockResolvedValue(undefined);

      await handleMessage(event, teamId, channelId);

      expect(dynamodb.putItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.putItem).toHaveBeenCalledWith(
        expect.any(String), // tableName from environment
        expect.objectContaining({
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
          type: 'message',
        })
      );
    });

    it('should skip channel_join events', async () => {
      const event: MessageEvent = {
        type: 'message',
        subtype: 'channel_join',
        ts: '1234567890.123456',
        channel: 'C123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      await handleMessage(event, teamId, channelId);

      expect(dynamodb.putItem).not.toHaveBeenCalled();
    });

    it('should skip channel_leave events', async () => {
      const event: MessageEvent = {
        type: 'message',
        subtype: 'channel_leave',
        ts: '1234567890.123456',
        channel: 'C123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      await handleMessage(event, teamId, channelId);

      expect(dynamodb.putItem).not.toHaveBeenCalled();
    });
  });

  describe('handleMessageChanged', () => {
    it('should update message in DynamoDB', async () => {
      const event: MessageChangedEvent = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated message',
          user: 'U123456',
        },
        event_ts: '1234567891.000000',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      (dynamodb.updateItem as jest.Mock).mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(dynamodb.updateItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.updateItem).toHaveBeenCalledWith(
        expect.any(String), // tableName from environment
        {
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
        },
        expect.stringContaining('SET text = :text'),
        expect.objectContaining({
          ':text': 'Updated message',
          ':user': 'U123456',
        })
      );
    });

    it('should create message if update fails with ValidationException', async () => {
      const event: MessageChangedEvent = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated message',
        },
        event_ts: '1234567891.000000',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      (dynamodb.updateItem as jest.Mock).mockRejectedValue({ code: 'ValidationException' });
      (dynamodb.putItem as jest.Mock).mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(dynamodb.updateItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.putItem).toHaveBeenCalledTimes(1);
    });

    it('should throw error if message.ts is missing', async () => {
      const event: MessageChangedEvent = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          // Missing ts
          text: 'Updated message',
        },
        event_ts: '1234567891.000000',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      await expect(handleMessageChanged(event, teamId, channelId)).rejects.toThrow(
        'Invalid message_changed event: missing message.ts'
      );
    });
  });

  describe('handleMessageDeleted', () => {
    it('should mark message as deleted in DynamoDB', async () => {
      const event: MessageDeletedEvent = {
        type: 'message',
        subtype: 'message_deleted',
        team_id: 'T123456',
        channel: 'C123456',
        deleted_ts: '1234567890.123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      (dynamodb.updateItem as jest.Mock).mockResolvedValue(undefined);

      await handleMessageDeleted(event, teamId, channelId);

      expect(dynamodb.updateItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.updateItem).toHaveBeenCalledWith(
        expect.any(String), // tableName from environment
        {
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
        },
        'SET deleted = :true',
        { ':true': true }
      );
    });
  });
});

