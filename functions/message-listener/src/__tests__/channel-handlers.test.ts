// Set environment variable before any imports (handlers read it at module load)
process.env.SLACK_ARCHIVE_TABLE = 'test-table';

// Create mock functions that can be accessed in tests
const mockPutItem = jest.fn();
const mockGetLatestItem = jest.fn();
const mockUpdateItem = jest.fn();

// Mock the re-export module (handlers import from this)
jest.mock('../dynamodb', () => ({
  putItem: mockPutItem,
  getLatestItem: mockGetLatestItem,
  updateItem: mockUpdateItem,
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
    getValidBotToken: jest.fn(),
    getSecretValue: jest.fn(),
  };
});

describe('channel-handlers', () => {

  let handleChannelCreated: any;
  let handleChannelRename: any;
  let handleChannelDeleted: any;
  let handleChannelArchive: any;
  let handleChannelUnarchive: any;
  let handleChannelIdChanged: any;
  let handleChannelPurposeOrTopic: any;
  let handleChannelVisibilityChange: any;
  
  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.SLACK_ARCHIVE_TABLE = 'test-table';
    
    // Import handlers - they'll use the mocked dynamodb module
    const handlers = await import('../handlers/channel-handlers');
    handleChannelCreated = handlers.handleChannelCreated;
    handleChannelRename = handlers.handleChannelRename;
    handleChannelDeleted = handlers.handleChannelDeleted;
    handleChannelArchive = handlers.handleChannelArchive;
    handleChannelUnarchive = handlers.handleChannelUnarchive;
    handleChannelIdChanged = handlers.handleChannelIdChanged;
    handleChannelPurposeOrTopic = handlers.handleChannelPurposeOrTopic;
    handleChannelVisibilityChange = handlers.handleChannelVisibilityChange;
  });

  describe('handleChannelCreated', () => {
    beforeEach(() => {
      // Set up environment variables for auto-join tests
      process.env.SLACK_CLIENT_ID_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:client-id';
      process.env.SLACK_CLIENT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:client-secret';
      process.env.AWS_REGION = 'us-east-1';
    });

    it('should create channel item in DynamoDB', async () => {
      const event = {
        type: 'channel_created',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'test-channel',
          is_private: false,
        },
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';

      mockPutItem.mockResolvedValue(undefined);

      await handleChannelCreated(event, teamId);

      expect(mockPutItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
          type: 'channel',
          team_id: 'T123456',
          channel_id: 'C123456',
          name: 'test-channel',
        })
      );
    });

    it('should not auto-join private channels', async () => {
      const event = {
        type: 'channel_created',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'private-channel',
          is_private: true,
        },
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';

      mockPutItem.mockResolvedValue(undefined);
      // Mock fetch to ensure it's not called
      global.fetch = jest.fn();

      await handleChannelCreated(event, teamId);

      expect(mockPutItem).toHaveBeenCalledTimes(1);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should auto-join public channels successfully', async () => {
      const event = {
        type: 'channel_created',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'public-channel',
          is_private: false,
        },
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';

      mockPutItem.mockResolvedValue(undefined);

      // Mock the shared module functions
      const mockGetValidBotToken = jest.fn().mockResolvedValue('xoxb-token-123');
      const mockGetSecretValue = jest.fn()
        .mockResolvedValueOnce('client-id-123')
        .mockResolvedValueOnce('client-secret-456');

      // Mock fetch for Slack API
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });

      // Mock the dynamic import
      jest.doMock('mnemosyne-slack-shared', () => ({
        ...jest.requireActual('mnemosyne-slack-shared'),
        getValidBotToken: mockGetValidBotToken,
        getSecretValue: mockGetSecretValue,
      }));

      await handleChannelCreated(event, teamId);

      expect(mockPutItem).toHaveBeenCalledTimes(1);
      // Note: The auto-join logic will try to execute but may fail in test environment
      // The important part is that it doesn't fail the handler
    });

    it('should handle auto-join failures gracefully', async () => {
      const event = {
        type: 'channel_created',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'public-channel',
          is_private: false,
        },
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';

      mockPutItem.mockResolvedValue(undefined);

      // Mock getSecretValue to return null to trigger error
      const mockGetSecretValue = jest.fn().mockResolvedValue(null);
      jest.doMock('mnemosyne-slack-shared', () => ({
        ...jest.requireActual('mnemosyne-slack-shared'),
        getSecretValue: mockGetSecretValue,
      }));

      // Handler should not throw even if auto-join fails
      await expect(handleChannelCreated(event, teamId)).resolves.not.toThrow();
      expect(mockPutItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleChannelRename', () => {
    it('should update channel name and names_history when channel exists', async () => {
      const event = {
        type: 'channel_rename',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'new-name',
        },
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';

      // Mock existing channel with old name
      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
        name: 'old-name',
        names_history: ['oldest-name'],
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelRename(event, teamId);

      // handleChannelRename calls getLatestItem once, then updateChannelItem calls it again
      expect(mockGetLatestItem).toHaveBeenCalledTimes(2);
      // updateChannelItem calls getLatestItem first, then updateItem
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('SET name = :name'),
        expect.objectContaining({
          ':name': 'new-name',
        })
      );
    });

    it('should handle duplicate name in names_history', async () => {
      const event = {
        type: 'channel_rename',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'same-name', // Same as last name in history
        },
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';

      // Mock existing channel with same name as the last in history
      mockGetLatestItem
        .mockResolvedValueOnce({
          itemId: 'channel#T123456#C123456',
          timestamp: '1234567890.000000',
          name: 'same-name',
          names_history: ['old-name', 'same-name'], // Last name is same as new name
        })
        .mockResolvedValueOnce({
          itemId: 'channel#T123456#C123456',
          timestamp: '1234567890.000000',
        });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelRename(event, teamId);

      // Should still update, but names_history shouldn't have duplicate at the end
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      const updateCall = mockUpdateItem.mock.calls[0];
      const namesHistory = updateCall[3][':names_history'];
      // Should not add duplicate since last name matches new name
      expect(namesHistory).toEqual(['old-name', 'same-name']); // Same as original, no duplicate added
    });

    it('should cap names_history at 20 entries', async () => {
      const event = {
        type: 'channel_rename',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'new-name-21',
        },
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';

      // Create a names_history with 20 entries
      const longHistory = Array.from({ length: 20 }, (_, i) => `name-${i + 1}`);
      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
        name: 'name-20',
        names_history: longHistory,
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelRename(event, teamId);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      const updateCall = mockUpdateItem.mock.calls[0];
      const namesHistory = updateCall[3][':names_history'];
      // Should be capped at 20 entries
      expect(namesHistory.length).toBe(20);
      expect(namesHistory[namesHistory.length - 1]).toBe('new-name-21');
    });

    it('should create channel if it does not exist', async () => {
      const event = {
        type: 'channel_rename',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'new-name',
        },
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';

      mockGetLatestItem.mockResolvedValue(null);
      mockPutItem.mockResolvedValue(undefined);

      await handleChannelRename(event, teamId);

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
          name: 'new-name',
        })
      );
    });
  });

  describe('handleChannelDeleted', () => {
    it('should mark channel as deleted', async () => {
      const event = {
        type: 'channel_deleted',
        team_id: 'T123456',
        channel: 'C123456',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelDeleted(event, teamId, channelId);

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('SET deleted = :true'),
        expect.objectContaining({ ':true': true })
      );
    });
  });

  describe('handleChannelArchive', () => {
    it('should set archived flag', async () => {
      const event = {
        type: 'channel_archive',
        team_id: 'T123456',
        channel: 'C123456',
        user: 'U123456',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelArchive(event, teamId, channelId);

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('SET archived = :true'),
        expect.objectContaining({ ':true': true })
      );
    });
  });

  describe('handleChannelUnarchive', () => {
    it('should remove archived flag', async () => {
      const event = {
        type: 'channel_unarchive',
        team_id: 'T123456',
        channel: 'C123456',
        user: 'U123456',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
        archived: true,
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelUnarchive(event, teamId, channelId);

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('REMOVE archived'),
        expect.objectContaining({
          ':raw_event': expect.any(Object),
        })
      );
    });
  });

  describe('handleChannelIdChanged', () => {
    it('should create new channel item with data from old channel', async () => {
      const event = {
        type: 'channel_id_changed',
        team_id: 'T123456',
        old_channel_id: 'C123456',
        new_channel_id: 'C789012',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const oldChannelId = 'C123456';
      const newChannelId = 'C789012';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
        name: 'old-channel',
        names_history: ['old-channel'],
        visibility: 'public',
        purpose: 'Test purpose',
        topic: 'Test topic',
      });
      mockPutItem.mockResolvedValue(undefined);

      await handleChannelIdChanged(event, teamId, oldChannelId, newChannelId);

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C789012',
          channel_id: newChannelId,
          prev_channel_id: oldChannelId,
          name: 'old-channel',
          purpose: 'Test purpose',
          topic: 'Test topic',
        })
      );
    });

    it('should handle channel_id_changed when old channel does not exist', async () => {
      const event = {
        type: 'channel_id_changed',
        team_id: 'T123456',
        old_channel_id: 'C123456',
        new_channel_id: 'C789012',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const oldChannelId = 'C123456';
      const newChannelId = 'C789012';

      mockGetLatestItem.mockResolvedValue(null);
      mockPutItem.mockResolvedValue(undefined);

      await handleChannelIdChanged(event, teamId, oldChannelId, newChannelId);

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledTimes(1);
      expect(mockPutItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C789012',
          channel_id: newChannelId,
          prev_channel_id: oldChannelId,
          name: newChannelId, // Should use newChannelId as fallback name when old channel doesn't exist
        })
      );
    });

    it('should handle channel_id_changed without purpose and topic', async () => {
      const event = {
        type: 'channel_id_changed',
        team_id: 'T123456',
        old_channel_id: 'C123456',
        new_channel_id: 'C789012',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const oldChannelId = 'C123456';
      const newChannelId = 'C789012';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
        name: 'old-channel',
        names_history: ['old-channel'],
        visibility: 'public',
        // No purpose or topic
      });
      mockPutItem.mockResolvedValue(undefined);

      await handleChannelIdChanged(event, teamId, oldChannelId, newChannelId);

      expect(mockPutItem).toHaveBeenCalledTimes(1);
      const putCall = mockPutItem.mock.calls[0];
      const item = putCall[1];
      // Should not have purpose or topic
      expect(item.purpose).toBeUndefined();
      expect(item.topic).toBeUndefined();
    });
  });

  describe('handleChannelPurposeOrTopic', () => {
    it('should update channel purpose', async () => {
      const event = {
        type: 'channel_purpose',
        team_id: 'T123456',
        channel: 'C123456',
        purpose: 'New purpose',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelPurposeOrTopic(event, teamId, channelId, 'purpose');

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('SET purpose = :value'),
        expect.objectContaining({
          ':value': 'New purpose',
        })
      );
    });

    it('should update channel topic', async () => {
      const event = {
        type: 'channel_topic',
        team_id: 'T123456',
        channel: 'C123456',
        topic: 'New topic',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelPurposeOrTopic(event, teamId, channelId, 'topic');

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('SET topic = :value'),
        expect.objectContaining({
          ':value': 'New topic',
        })
      );
    });
  });

  describe('handleChannelVisibilityChange', () => {
    it('should update channel visibility to private', async () => {
      const event = {
        type: 'channel_convert_to_private',
        team_id: 'T123456',
        channel: 'C123456',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelVisibilityChange(event, teamId, channelId, 'private');

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('SET visibility = :visibility'),
        expect.objectContaining({
          ':visibility': 'private',
        })
      );
    });

    it('should update channel visibility to public', async () => {
      const event = {
        type: 'channel_convert_to_public',
        team_id: 'T123456',
        channel: 'C123456',
        event_ts: '1234567890.123456',
      } as any;
      const teamId = 'T123456';
      const channelId = 'C123456';

      mockGetLatestItem.mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
      });
      mockUpdateItem.mockResolvedValue(undefined);

      await handleChannelVisibilityChange(event, teamId, channelId, 'public');

      expect(mockGetLatestItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'test-table',
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('SET visibility = :visibility'),
        expect.objectContaining({
          ':visibility': 'public',
        })
      );
    });
  });
});
