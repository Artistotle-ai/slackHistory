import {
  handleChannelCreated,
  handleChannelRename,
  handleChannelDeleted,
  handleChannelArchive,
  handleChannelUnarchive,
} from '../handlers/channel-handlers';
import {
  ChannelCreatedEvent,
  ChannelRenameEvent,
  ChannelDeletedEvent,
  ChannelArchiveEvent,
  ChannelUnarchiveEvent,
} from 'mnemosyne-slack-shared';
import * as dynamodb from '../dynamodb';

// Set environment variable before importing handlers (handlers read it at module load)
process.env.SLACK_ARCHIVE_TABLE = 'test-table';

// Mock DynamoDB functions
jest.mock('../dynamodb');
jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('channel-handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleChannelCreated', () => {
    it('should create channel item in DynamoDB', async () => {
      const event: ChannelCreatedEvent = {
        type: 'channel_created',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'test-channel',
        },
      };
      const teamId = 'T123456';

      (dynamodb.putItem as jest.Mock).mockResolvedValue(undefined);

      await handleChannelCreated(event, teamId);

      expect(dynamodb.putItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.putItem).toHaveBeenCalledWith(
        expect.any(String), // tableName from environment
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
          type: 'channel',
          team_id: 'T123456',
          channel_id: 'C123456',
          name: 'test-channel',
        })
      );
    });
  });

  describe('handleChannelRename', () => {
    it('should update channel name and names_history', async () => {
      const event: ChannelRenameEvent = {
        type: 'channel_rename',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'new-name',
        },
      };
      const teamId = 'T123456';

      // Mock existing channel with old name
      (dynamodb.getLatestItem as jest.Mock).mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
        name: 'old-name',
        names_history: ['oldest-name'],
      });
      (dynamodb.updateItem as jest.Mock).mockResolvedValue(undefined);

      await handleChannelRename(event, teamId);

      expect(dynamodb.getLatestItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.updateItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.updateItem).toHaveBeenCalledWith(
        expect.any(String), // tableName from environment
        expect.objectContaining({
          itemId: 'channel#T123456#C123456',
        }),
        expect.stringContaining('SET name = :name'),
        expect.objectContaining({
          ':name': 'new-name',
        })
      );
    });
  });

  describe('handleChannelDeleted', () => {
    it('should mark channel as deleted', async () => {
      const event: ChannelDeletedEvent = {
        type: 'channel_deleted',
        team_id: 'T123456',
        channel: 'C123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      (dynamodb.getLatestItem as jest.Mock).mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
        name: 'test-channel',
      });
      (dynamodb.updateItem as jest.Mock).mockResolvedValue(undefined);

      await handleChannelDeleted(event, teamId, channelId);

      expect(dynamodb.updateItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.updateItem).toHaveBeenCalledWith(
        expect.any(String), // tableName from environment
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
      const event: ChannelArchiveEvent = {
        type: 'channel_archive',
        team_id: 'T123456',
        channel: 'C123456',
        user: 'U123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      (dynamodb.getLatestItem as jest.Mock).mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
      });
      (dynamodb.updateItem as jest.Mock).mockResolvedValue(undefined);

      await handleChannelArchive(event, teamId, channelId);

      expect(dynamodb.updateItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.updateItem).toHaveBeenCalledWith(
        expect.any(String), // tableName from environment
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
      const event: ChannelUnarchiveEvent = {
        type: 'channel_unarchive',
        team_id: 'T123456',
        channel: 'C123456',
        user: 'U123456',
      };
      const teamId = 'T123456';
      const channelId = 'C123456';

      (dynamodb.getLatestItem as jest.Mock).mockResolvedValue({
        itemId: 'channel#T123456#C123456',
        timestamp: '1234567890.000000',
        archived: true,
      });
      (dynamodb.updateItem as jest.Mock).mockResolvedValue(undefined);

      await handleChannelUnarchive(event, teamId, channelId);

      expect(dynamodb.updateItem).toHaveBeenCalledTimes(1);
      expect(dynamodb.updateItem).toHaveBeenCalledWith(
        expect.any(String), // tableName from environment
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
});

