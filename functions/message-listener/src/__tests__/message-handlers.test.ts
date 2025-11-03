// Set environment variable before any imports (handlers read it at module load)
process.env.SLACK_ARCHIVE_TABLE = 'test-table';

// Create mock functions that can be accessed in tests
const mockPutItem = jest.fn();
const mockUpdateItem = jest.fn();

// Mock the re-export module (handlers import from this)
jest.mock('../dynamodb', () => ({
  putItem: mockPutItem,
  updateItem: mockUpdateItem,
}));

// Mock repositories
jest.mock('../repositories', () => ({
  getMessageRepository: jest.fn(() => ({
    save: jest.fn(),
    getLatest: jest.fn(),
  })),
}));

// Mock logger from shared package
jest.mock('mnemosyne-slack-shared', () => {
  const actual = jest.requireActual('mnemosyne-slack-shared');
  return {
    ...actual,
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
  };
});

describe('message-handlers', () => {
  let buildMessageItem: any;
  let handleMessage: any;
  let handleMessageChanged: any;
  let handleMessageDeleted: any;
  
  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.SLACK_ARCHIVE_TABLE = 'test-table';
    
    // Import handlers - they'll use the mocked dynamodb module
    const handlers = await import('../handlers/message-handlers');
    buildMessageItem = handlers.buildMessageItem;
    handleMessage = handlers.handleMessage;
    handleMessageChanged = handlers.handleMessageChanged;
    handleMessageDeleted = handlers.handleMessageDeleted;
  });

  describe('buildMessageItem', () => {
    it('should build message item with required fields', () => {
      const event = {
        ts: '1234567890.123456',
        text: 'Hello world',
        user: 'U123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      const item = buildMessageItem(event, teamId, channelId);

      expect(item.itemId).toBe('message#T123456#C123456');
      expect(item.timestamp).toBe('1234567890.123456');
      expect(item.type).toBe('message');
      expect(item.team_id).toBe('T123456');
      expect(item.channel_id).toBe('C123456');
      expect(item.text).toBe('Hello world');
      expect(item.user).toBe('U123456');
    });

    it('should include optional fields when present', () => {
      const event = {
        ts: '1234567890.123456',
        text: 'Hello',
        user: 'U123456',
        thread_ts: '1234567890.000000',
        files: [
          {
            id: 'F123456',
            name: 'test.pdf',
          },
        ],
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      const item = buildMessageItem(event, teamId, channelId);

      expect(item.thread_ts).toBe('1234567890.000000');
      expect(item.parent).toBe('thread#T123456#1234567890.000000');
      expect(item.files).toBeDefined();
    });

    it('should exclude optional fields when not present', () => {
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
      const event = {
        type: 'message',
        ts: '1234567890.123456',
        text: 'Hello world',
        user: 'U123456',
        channel: 'C123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockPutItem.mockResolvedValue(undefined);

      await handleMessage(event, teamId, channelId);

      expect(mockPutItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
          type: 'message',
        })
      );
    });

    it('should skip channel_join events', async () => {
      const event = {
        type: 'message',
        subtype: 'channel_join',
        ts: '1234567890.123456',
        channel: 'C123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      await handleMessage(event, teamId, channelId);

      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it('should skip channel_leave events', async () => {
      const event = {
        type: 'message',
        subtype: 'channel_leave',
        ts: '1234567890.123456',
        channel: 'C123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      await handleMessage(event, teamId, channelId);

      expect(mockPutItem).not.toHaveBeenCalled();
    });
  });

  describe('handleMessageChanged', () => {
    it('should update existing message', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated',
        },
        edited: {
          ts: '1234567891.123456',
        },
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockUpdateItem.mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
        }),
        expect.stringContaining('SET text = :text'),
        expect.objectContaining({
          ':text': 'Updated',
        })
      );
    });

    it('should create new message if update fails with ValidationException', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'New',
        },
        event_ts: '1234567891.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      const validationError = { code: 'ValidationException' };
      mockUpdateItem.mockRejectedValueOnce(validationError);
      mockPutItem.mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
          updated_ts: '1234567891.123456',
        })
      );
    });

    it('should create new message if update fails with ResourceNotFoundException', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'New',
        },
        event_ts: '1234567891.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      const resourceNotFoundError = { code: 'ResourceNotFoundException' };
      mockUpdateItem.mockRejectedValueOnce(resourceNotFoundError);
      mockPutItem.mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
        })
      );
    });

    it('should re-throw unexpected errors', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated',
        },
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      const unexpectedError = { code: 'ThrottlingException', message: 'Rate exceeded' };
      mockUpdateItem.mockRejectedValueOnce(unexpectedError);

      await expect(handleMessageChanged(event, teamId, channelId)).rejects.toEqual(unexpectedError);
      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it('should handle message_changed with user field', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated',
          user: 'U123456',
        },
        edited: {
          ts: '1234567891.123456',
        },
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockUpdateItem.mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
        }),
        expect.stringContaining('user = :user'),
        expect.objectContaining({
          ':user': 'U123456',
        })
      );
    });

    it('should handle message_changed without user field', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated',
          // No user field
        },
        edited: {
          ts: '1234567891.123456',
        },
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockUpdateItem.mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      const updateCall = mockUpdateItem.mock.calls[0];
      const updateExpression = updateCall[2];
      // Should not include user in update expression
      expect(updateExpression).not.toContain('user');
      expect(updateCall[3]).not.toHaveProperty(':user');
    });

    it('should handle message_changed with empty text', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: '', // Empty text (message was cleared)
        },
        edited: {
          ts: '1234567891.123456',
        },
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockUpdateItem.mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'message#T123456#C123456',
          timestamp: '1234567890.123456',
        }),
        expect.stringContaining('SET text = :text'),
        expect.objectContaining({
          ':text': '', // Empty string when text is removed
        })
      );
    });

    it('should throw error if message.ts is missing', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          // Missing ts
          text: 'Updated',
        },
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      await expect(handleMessageChanged(event, teamId, channelId)).rejects.toThrow(
        "Invalid message_changed event: missing message.ts"
      );
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('should use event_ts as fallback for updated_ts if edited.ts is missing', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated',
        },
        event_ts: '1234567891.123456',
        // No edited.ts
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockUpdateItem.mockResolvedValue(undefined);

      await handleMessageChanged(event, teamId, channelId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      const updateCall = mockUpdateItem.mock.calls[0];
      expect(updateCall[3][':updated_ts']).toBe('1234567891.123456');
    });
  });

  describe('handleMessageDeleted', () => {
    it('should mark message as deleted', async () => {
      const event = {
        type: 'message',
        subtype: 'message_deleted',
        team_id: 'T123456',
        channel: 'C123456',
        deleted_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockUpdateItem.mockResolvedValue(undefined);

      await handleMessageDeleted(event, teamId, channelId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
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
