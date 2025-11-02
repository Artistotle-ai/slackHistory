import { routeEvent } from '../event-router';
import {
  UrlVerificationEvent,
  MessageEvent,
  MessageChangedEvent,
  MessageDeletedEvent,
  ChannelCreatedEvent,
  ChannelRenameEvent,
  ChannelDeletedEvent,
  ChannelArchiveEvent,
  ChannelUnarchiveEvent,
  UnknownEvent,
} from 'mnemosyne-slack-shared';

// Mock handlers modules that are dynamically imported
jest.mock('../handlers/message-handlers', () => ({
  handleMessage: jest.fn(),
  handleMessageChanged: jest.fn(),
  handleMessageDeleted: jest.fn(),
}));

jest.mock('../handlers/channel-handlers', () => ({
  handleChannelCreated: jest.fn(),
  handleChannelRename: jest.fn(),
  handleChannelDeleted: jest.fn(),
  handleChannelArchive: jest.fn(),
  handleChannelUnarchive: jest.fn(),
}));

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  getMessageChannelId: jest.fn((event: any) => event.channel || event.channel_id),
}));

const messageHandlers = require('../handlers/message-handlers');
const channelHandlers = require('../handlers/channel-handlers');

describe('event-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('routeEvent', () => {
    it('should route url_verification events', async () => {
      const event: UrlVerificationEvent = {
        type: 'url_verification',
        challenge: 'test-challenge',
      };

      await routeEvent(event);

      // URL verification should be handled before routing
      expect(messageHandlers.handleMessage).not.toHaveBeenCalled();
      expect(channelHandlers.handleChannelCreated).not.toHaveBeenCalled();
    });

    it('should route message events', async () => {
      const event: MessageEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
        text: 'Hello',
      };

      (messageHandlers.handleMessage as jest.Mock).mockResolvedValue(undefined);

      await routeEvent(event);

      expect(messageHandlers.handleMessage).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456'
      );
    });

    it('should route message_changed events', async () => {
      const event: MessageChangedEvent = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated',
        },
      };

      (messageHandlers.handleMessageChanged as jest.Mock).mockResolvedValue(undefined);

      await routeEvent(event);

      expect(messageHandlers.handleMessageChanged).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456'
      );
    });

    it('should route message_deleted events', async () => {
      const event: MessageDeletedEvent = {
        type: 'message',
        subtype: 'message_deleted',
        team_id: 'T123456',
        channel: 'C123456',
        deleted_ts: '1234567890.123456',
      };

      (messageHandlers.handleMessageDeleted as jest.Mock).mockResolvedValue(undefined);

      await routeEvent(event);

      expect(messageHandlers.handleMessageDeleted).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456'
      );
    });

    it('should route channel_created events', async () => {
      const event: ChannelCreatedEvent = {
        type: 'channel_created',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'test-channel',
        },
      };

      (channelHandlers.handleChannelCreated as jest.Mock).mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelCreated).toHaveBeenCalledWith(
        event,
        'T123456'
      );
    });

    it('should route channel_rename events', async () => {
      const event: ChannelRenameEvent = {
        type: 'channel_rename',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'new-name',
        },
      };

      (channelHandlers.handleChannelRename as jest.Mock).mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelRename).toHaveBeenCalledWith(
        event,
        'T123456'
      );
    });

    it('should route channel_deleted events', async () => {
      const event: ChannelDeletedEvent = {
        type: 'channel_deleted',
        team_id: 'T123456',
        channel: 'C123456',
      };

      (channelHandlers.handleChannelDeleted as jest.Mock).mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelDeleted).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456'
      );
    });

    it('should route channel_archive events', async () => {
      const event: ChannelArchiveEvent = {
        type: 'channel_archive',
        team_id: 'T123456',
        channel: 'C123456',
        user: 'U123456',
      };

      (channelHandlers.handleChannelArchive as jest.Mock).mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelArchive).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456'
      );
    });

    it('should route channel_unarchive events', async () => {
      const event: ChannelUnarchiveEvent = {
        type: 'channel_unarchive',
        team_id: 'T123456',
        channel: 'C123456',
        user: 'U123456',
      };

      (channelHandlers.handleChannelUnarchive as jest.Mock).mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelUnarchive).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456'
      );
    });

    it('should handle unknown events gracefully', async () => {
      const event: UnknownEvent = {
        type: 'unknown_event',
        team_id: 'T123456',
      };

      // Should not throw, just log and continue
      await expect(routeEvent(event)).resolves.not.toThrow();
    });
  });
});

