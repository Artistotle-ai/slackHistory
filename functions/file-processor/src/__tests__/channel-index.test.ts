import { maintainChannelIndex } from '../channel-index';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  putItem: jest.fn(),
  queryItems: jest.fn(),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('channel-index', () => {
  const mockPutItem = shared.putItem as jest.Mock;
  const mockQueryItems = shared.queryItems as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPutItem.mockResolvedValue(undefined);
  });

  describe('maintainChannelIndex', () => {
    it('should skip non-channel items', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        type: 'message',
      };

      await maintainChannelIndex(tableName, item);

      expect(mockQueryItems).not.toHaveBeenCalled();
      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it('should skip if team_id is missing', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      await maintainChannelIndex(tableName, item);

      expect(mockQueryItems).not.toHaveBeenCalled();
      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it('should skip if channel_id is missing', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        name: 'test-channel',
      };

      await maintainChannelIndex(tableName, item);

      expect(mockQueryItems).not.toHaveBeenCalled();
      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it('should create first shard if none exists', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      mockQueryItems.mockResolvedValue([]); // No existing shards

      await maintainChannelIndex(tableName, item);

      expect(mockQueryItems).toHaveBeenCalledWith({
        tableName,
        itemId: 'channelindex#T123',
        limit: 1,
        scanIndexForward: false,
      });
      expect(mockPutItem).toHaveBeenCalledWith(tableName, {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: { 'C456': 'test-channel' },
      });
    });

    it('should update existing shard with new channel', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      const existingShard = {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: { 'C789': 'existing-channel' },
      };

      mockQueryItems.mockResolvedValue([existingShard]);

      await maintainChannelIndex(tableName, item);

      expect(mockPutItem).toHaveBeenCalledWith(tableName, {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: {
          'C789': 'existing-channel',
          'C456': 'test-channel',
        },
      });
    });

    it('should handle deleted channels', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
        deleted: true,
      };

      const oldItem = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'old-channel-name',
      };

      const existingShard = {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: {},
      };

      mockQueryItems.mockResolvedValue([existingShard]);

      await maintainChannelIndex(tableName, item, oldItem);

      expect(mockPutItem).toHaveBeenCalledWith(tableName, {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: {
          'C456': 'deleted_old-channel-name',
        },
      });
    });

    it('should use current name if oldItem not provided for deleted channel', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'current-name',
        deleted: true,
      };

      const existingShard = {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: {},
      };

      mockQueryItems.mockResolvedValue([existingShard]);

      await maintainChannelIndex(tableName, item);

      expect(mockPutItem).toHaveBeenCalledWith(tableName, {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: {
          'C456': 'deleted_current-name',
        },
      });
    });

    it('should use "unknown" if name is missing', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
      };

      const existingShard = {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: {},
      };

      mockQueryItems.mockResolvedValue([existingShard]);

      await maintainChannelIndex(tableName, item);

      expect(mockPutItem).toHaveBeenCalledWith(tableName, {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: {
          'C456': 'unknown',
        },
      });
    });

    it('should create new shard when size limit exceeded', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      // Create a large shard that exceeds 350KB when updated
      const largeChannelsMap: Record<string, string> = {};
      for (let i = 0; i < 10000; i++) {
        largeChannelsMap[`C${i}`] = 'a'.repeat(100); // Large channel names
      }

      const existingShard = {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: largeChannelsMap,
      };

      mockQueryItems.mockResolvedValue([existingShard]);

      await maintainChannelIndex(tableName, item);

      // Should create new shard with timestamp '1'
      expect(mockPutItem).toHaveBeenCalledWith(
        tableName,
        expect.objectContaining({
          itemId: 'channelindex#T123',
          timestamp: '1',
          channels_map: { 'C456': 'test-channel' },
        })
      );
    });

    it('should update existing shard when size limit not exceeded', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      const existingShard = {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: { 'C789': 'small-channel' }, // Small shard
      };

      mockQueryItems.mockResolvedValue([existingShard]);

      await maintainChannelIndex(tableName, item);

      expect(mockPutItem).toHaveBeenCalledWith(tableName, {
        itemId: 'channelindex#T123',
        timestamp: '0',
        channels_map: {
          'C789': 'small-channel',
          'C456': 'test-channel',
        },
      });
    });

    it('should handle shard creation failure', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      mockQueryItems.mockResolvedValue([]); // No shards
      mockPutItem.mockResolvedValue(null); // Creation fails

      await maintainChannelIndex(tableName, item);

      expect(mockPutItem).toHaveBeenCalled();
      // Should not throw, just return
    });
  });
});

