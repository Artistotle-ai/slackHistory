// Set environment variable before importing modules
process.env.SLACK_ARCHIVE_TABLE = 'test-table';

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
  handleChannelIdChanged: jest.fn(),
  handleChannelPurposeOrTopic: jest.fn(),
  handleChannelVisibilityChange: jest.fn(),
}));

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
  getMessageChannelId: jest.fn((event: any) => event.channel || event.channel_id),
}));

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
  ChannelIdChangedEvent,
  ChannelPurposeEvent,
  ChannelTopicEvent,
  ChannelConvertToPrivateEvent,
  ChannelConvertToPublicEvent,
  FileSharedEvent,
  UnknownEvent,
} from 'mnemosyne-slack-shared';

// Import mocked handlers
const messageHandlers = require('../handlers/message-handlers');
const channelHandlers = require('../handlers/channel-handlers');

describe('event-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('routeEvent', () => {
    it('should throw error for url_verification events', async () => {
      const event: UrlVerificationEvent = {
        type: 'url_verification',
        challenge: 'test-challenge',
      };

      // URL verification should be handled before routing - should throw error
      await expect(routeEvent(event)).rejects.toThrow('URL verification should be handled before routing');
    });

    it('should route message events', async () => {
      const event: MessageEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        channel_id: 'C123456',
        ts: '1234567890.123456',
        text: 'Hello',
      };

      messageHandlers.handleMessage.mockResolvedValue(undefined);

      await routeEvent(event);

      expect(messageHandlers.handleMessage).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456'
      );
    });

    it('should route message_changed events', async () => {
      // MessageChangedEvent needs ts or event_ts for routing, but it's not in the type
      // The router checks "ts" in event, so we need to cast to include it for routing
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        channel_id: 'C123456',
        ts: '1234567890.123456', // Required for routing condition
        message: {
          type: 'message',
          ts: '1234567890.123456',
          text: 'Updated',
        },
      } as MessageChangedEvent & { ts: string }; // Add ts for routing condition

      messageHandlers.handleMessageChanged.mockResolvedValue(undefined);

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
        channel_id: 'C123456',
        deleted_ts: '1234567890.123456',
        ts: '1234567890.123456', // Add ts for routing condition
      };

      messageHandlers.handleMessageDeleted.mockResolvedValue(undefined);

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

      channelHandlers.handleChannelCreated.mockResolvedValue(undefined);

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

      channelHandlers.handleChannelRename.mockResolvedValue(undefined);

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

      channelHandlers.handleChannelDeleted.mockResolvedValue(undefined);

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

      channelHandlers.handleChannelArchive.mockResolvedValue(undefined);

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

      channelHandlers.handleChannelUnarchive.mockResolvedValue(undefined);

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

    it('should handle events without team_id', async () => {
      const event = {
        type: 'message',
        channel: 'C123456',
        ts: '1234567890.123456',
      } as any;

      // Should not throw, just log and continue
      await expect(routeEvent(event)).resolves.not.toThrow();
    });

    it('should handle events with non-string team_id', async () => {
      const event = {
        type: 'message',
        team_id: 123456,
        channel: 'C123456',
        ts: '1234567890.123456',
      } as any;

      // Should not throw, just log and continue
      await expect(routeEvent(event)).resolves.not.toThrow();
    });

    it('should handle message events without channel_id', async () => {
      const event = {
        type: 'message',
        team_id: 'T123456',
        ts: '1234567890.123456',
      } as any;

      // Mock getMessageChannelId to return null
      const sharedModule = require('mnemosyne-slack-shared');
      const originalGetMessageChannelId = sharedModule.getMessageChannelId;
      sharedModule.getMessageChannelId = jest.fn().mockReturnValueOnce(null);

      await routeEvent(event);

      expect(messageHandlers.handleMessage).not.toHaveBeenCalled();
      
      // Restore original
      sharedModule.getMessageChannelId = originalGetMessageChannelId;
    });

    it('should handle message events when getMessageChannelId returns non-string', async () => {
      const event = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
      } as any;

      // Mock getMessageChannelId to return non-string
      const sharedModule = require('mnemosyne-slack-shared');
      const originalGetMessageChannelId = sharedModule.getMessageChannelId;
      sharedModule.getMessageChannelId = jest.fn().mockReturnValueOnce(123);

      await routeEvent(event);

      expect(messageHandlers.handleMessage).not.toHaveBeenCalled();
      
      // Restore original
      sharedModule.getMessageChannelId = originalGetMessageChannelId;
    });

    it('should route channel_id_changed events', async () => {
      const event: ChannelIdChangedEvent = {
        type: 'channel_id_changed',
        team_id: 'T123456',
        previous_channel: 'C123456',
        channel: 'C789012',
      };

      channelHandlers.handleChannelIdChanged.mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelIdChanged).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456',
        'C789012'
      );
    });

    it('should route channel_purpose events', async () => {
      const event: ChannelPurposeEvent = {
        type: 'channel_purpose',
        team_id: 'T123456',
        channel: 'C123456',
        purpose: 'Test purpose',
      };

      channelHandlers.handleChannelPurposeOrTopic.mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelPurposeOrTopic).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456',
        'purpose'
      );
    });

    it('should route channel_topic events', async () => {
      const event: ChannelTopicEvent = {
        type: 'channel_topic',
        team_id: 'T123456',
        channel: 'C123456',
        topic: 'Test topic',
      };

      channelHandlers.handleChannelPurposeOrTopic.mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelPurposeOrTopic).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456',
        'topic'
      );
    });

    it('should route channel_convert_to_private events', async () => {
      const event: ChannelConvertToPrivateEvent = {
        type: 'channel_convert_to_private',
        team_id: 'T123456',
        channel: 'C123456',
      };

      channelHandlers.handleChannelVisibilityChange.mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelVisibilityChange).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456',
        'private'
      );
    });

    it('should route channel_convert_to_public events', async () => {
      const event: ChannelConvertToPublicEvent = {
        type: 'channel_convert_to_public',
        team_id: 'T123456',
        channel: 'C123456',
      };

      channelHandlers.handleChannelVisibilityChange.mockResolvedValue(undefined);

      await routeEvent(event);

      expect(channelHandlers.handleChannelVisibilityChange).toHaveBeenCalledWith(
        event,
        'T123456',
        'C123456',
        'public'
      );
    });

    it('should handle file_shared events', async () => {
      const event: FileSharedEvent = {
        type: 'file_shared',
        team_id: 'T123456',
        file_id: 'F123456',
        channel_id: 'C123456',
      };

      // Should not throw, just log and continue
      await expect(routeEvent(event)).resolves.not.toThrow();
    });

    it('should handle channel_created events without channel object', async () => {
      const event = {
        type: 'channel_created',
        team_id: 'T123456',
        // channel property missing, not null
      } as any;

      await routeEvent(event);

      expect(channelHandlers.handleChannelCreated).not.toHaveBeenCalled();
    });

    it('should handle channel_rename events without channel object', async () => {
      const event = {
        type: 'channel_rename',
        team_id: 'T123456',
        // channel property missing, not null
      } as any;

      await routeEvent(event);

      expect(channelHandlers.handleChannelRename).not.toHaveBeenCalled();
    });

    it('should handle channel_deleted events without channelId', async () => {
      const event = {
        type: 'channel_deleted',
        team_id: 'T123456',
        channel: null,
      } as any;

      await routeEvent(event);

      expect(channelHandlers.handleChannelDeleted).not.toHaveBeenCalled();
    });

    it('should handle channel_archive events without user', async () => {
      const event = {
        type: 'channel_archive',
        team_id: 'T123456',
        channel: 'C123456',
      } as any;

      await routeEvent(event);

      expect(channelHandlers.handleChannelArchive).not.toHaveBeenCalled();
    });

    it('should handle channel_unarchive events without user', async () => {
      const event = {
        type: 'channel_unarchive',
        team_id: 'T123456',
        channel: 'C123456',
      } as any;

      await routeEvent(event);

      expect(channelHandlers.handleChannelUnarchive).not.toHaveBeenCalled();
    });

    it('should handle unhandled event types', async () => {
      const event = {
        type: 'unhandled_event_type',
        team_id: 'T123456',
      } as any;

      // Should not throw, just log and continue
      await expect(routeEvent(event)).resolves.not.toThrow();
    });

    it('should handle message events without subtype or ts', async () => {
      const event = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
      } as any;

      await routeEvent(event);

      expect(messageHandlers.handleMessage).not.toHaveBeenCalled();
    });

    it('should handle message_changed events without message field', async () => {
      const event = {
        type: 'message',
        subtype: 'message_changed',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
      } as any;

      await routeEvent(event);

      expect(messageHandlers.handleMessageChanged).not.toHaveBeenCalled();
    });

    it('should handle message_deleted events without deleted_ts', async () => {
      const event = {
        type: 'message',
        subtype: 'message_deleted',
        team_id: 'T123456',
        channel: 'C123456',
        ts: '1234567890.123456',
      } as any;

      await routeEvent(event);

      expect(messageHandlers.handleMessageDeleted).not.toHaveBeenCalled();
    });
  });
});

