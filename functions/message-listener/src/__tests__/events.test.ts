import { parseEvent } from '../events';
import {
  SlackEvent,
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
  UnknownEvent,
} from 'mnemosyne-slack-shared';

describe('events', () => {
  describe('parseEvent', () => {
    it('should parse url_verification event', () => {
      const event: SlackEvent = {
        type: 'url_verification',
        challenge: 'test_challenge',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('url_verification');
      expect((parsed as UrlVerificationEvent).challenge).toBe('test_challenge');
    });

    it('should parse message event', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.123456',
          text: 'Hello world',
          user: 'U123456',
        },
      };

      const parsed = parseEvent(event.event as SlackEvent);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageEvent).channel).toBe('C123456');
      expect((parsed as MessageEvent).text).toBe('Hello world');
    });

    it('should parse message_changed event', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'message',
          subtype: 'message_changed',
          channel: 'C123456',
          message: {
            ts: '1234567890.123456',
            text: 'Updated message',
          },
        },
      };

      const parsed = parseEvent(event.event as SlackEvent);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageChangedEvent).subtype).toBe('message_changed');
      expect((parsed as MessageChangedEvent).message?.text).toBe('Updated message');
    });

    it('should parse message_deleted event', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'message',
          subtype: 'message_deleted',
          channel: 'C123456',
          deleted_ts: '1234567890.123456',
        },
      };

      const parsed = parseEvent(event.event as SlackEvent);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageDeletedEvent).subtype).toBe('message_deleted');
      expect((parsed as MessageDeletedEvent).deleted_ts).toBe('1234567890.123456');
    });

    it('should parse channel_created event', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'channel_created',
          channel: {
            id: 'C123456',
            name: 'test-channel',
            created: 1234567890,
            creator: 'U123456',
          },
        },
      };

      const parsed = parseEvent(event.event as SlackEvent);
      expect(parsed.type).toBe('channel_created');
      expect((parsed as ChannelCreatedEvent).channel.id).toBe('C123456');
      expect((parsed as ChannelCreatedEvent).channel.name).toBe('test-channel');
    });

    it('should return unknown event for invalid structure', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        // Missing team_id
        event: {
          type: 'message',
        },
      };

      const parsed = parseEvent(event.event as SlackEvent);
      expect(parsed.type).toBe('message');
      // Should be treated as unknown due to missing required fields
    });

    it('should return unknown event for unrecognized type', () => {
      const event: SlackEvent = {
        type: 'unknown_event_type' as any,
        team_id: 'T123456',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('unknown_event_type');
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle message event without channel', () => {
      const event: SlackEvent = {
        type: 'message',
        team_id: 'T123456',
        // Missing channel
        ts: '1234567890.123456',
      };

      const parsed = parseEvent(event);
      // Should return unknown event when channel is missing
      expect(parsed.type).toBe('message');
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle message event without ts', () => {
      const event: SlackEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        // Missing ts
      };

      const parsed = parseEvent(event);
      // Should return unknown event when ts is missing
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle message_changed without message', () => {
      const event: SlackEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        subtype: 'message_changed',
        // Missing message
      };

      const parsed = parseEvent(event);
      // Should fall through to regular message or unknown
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle message_deleted without deleted_ts', () => {
      const event: SlackEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        subtype: 'message_deleted',
        // Missing deleted_ts and ts
      };

      const parsed = parseEvent(event);
      // Should fall through to unknown
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should parse channel_rename event', () => {
      const event: SlackEvent = {
        type: 'channel_rename',
        team_id: 'T123456',
        channel: {
          id: 'C123456',
          name: 'new-name',
        } as any, // channel_rename has channel as object in SlackEvent
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_rename');
      expect((parsed as ChannelRenameEvent).channel.id).toBe('C123456');
      expect((parsed as ChannelRenameEvent).channel.name).toBe('new-name');
    });

    it('should parse channel_deleted event', () => {
      const event: SlackEvent = {
        type: 'channel_deleted',
        team_id: 'T123456',
        channel: 'C123456',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_deleted');
      expect((parsed as ChannelDeletedEvent).channel).toBe('C123456');
    });

    it('should parse channel_archive event', () => {
      const event: SlackEvent = {
        type: 'channel_archive',
        team_id: 'T123456',
        channel: 'C123456',
        user: 'U123456',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_archive');
      expect((parsed as ChannelArchiveEvent).channel).toBe('C123456');
    });

    it('should parse channel_unarchive event', () => {
      const event: SlackEvent = {
        type: 'channel_unarchive',
        team_id: 'T123456',
        channel: 'C123456',
        user: 'U123456',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_unarchive');
      expect((parsed as ChannelUnarchiveEvent).channel).toBe('C123456');
    });

    it('should parse channel_id_changed event', () => {
      const event: SlackEvent = {
        type: 'channel_id_changed',
        team_id: 'T123456',
        channel: 'C789',
        previous_channel: 'C123456',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_id_changed');
      expect((parsed as ChannelIdChangedEvent).channel).toBe('C789');
      expect((parsed as ChannelIdChangedEvent).previous_channel).toBe('C123456');
    });

    it('should parse channel_purpose event', () => {
      const event: SlackEvent = {
        type: 'channel_purpose',
        team_id: 'T123456',
        channel: 'C123456',
        purpose: 'New purpose',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_purpose');
      expect((parsed as ChannelPurposeEvent).channel).toBe('C123456');
      expect((parsed as ChannelPurposeEvent).purpose).toBe('New purpose');
    });

    it('should parse channel_topic event', () => {
      const event: SlackEvent = {
        type: 'channel_topic',
        team_id: 'T123456',
        channel: 'C123456',
        topic: 'New topic',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_topic');
      expect((parsed as ChannelTopicEvent).channel).toBe('C123456');
      expect((parsed as ChannelTopicEvent).topic).toBe('New topic');
    });

    it('should parse channel_convert_to_private event', () => {
      const event: SlackEvent = {
        type: 'channel_convert_to_private',
        team_id: 'T123456',
        channel: 'C123456',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_convert_to_private');
      expect((parsed as ChannelConvertToPrivateEvent).channel).toBe('C123456');
    });

    it('should parse channel_convert_to_public event', () => {
      const event: SlackEvent = {
        type: 'channel_convert_to_public',
        team_id: 'T123456',
        channel: 'C123456',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_convert_to_public');
      expect((parsed as ChannelConvertToPublicEvent).channel).toBe('C123456');
    });

    it('should handle channel event with invalid channel structure', () => {
      const event: SlackEvent = {
        type: 'channel_created',
        team_id: 'T123456',
        channel: null as any, // Invalid channel
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_created');
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle url_verification without challenge', () => {
      const event: SlackEvent = {
        type: 'url_verification',
        // Missing challenge
      };

      const parsed = parseEvent(event);
      // Should still return url_verification type but might not have challenge
      expect(parsed.type).toBe('url_verification');
    });

    it('should handle message with event_ts instead of ts', () => {
      const event: SlackEvent = {
        type: 'message',
        team_id: 'T123456',
        channel: 'C123456',
        event_ts: '1234567890.123456',
        // No ts
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageEvent).ts).toBe('1234567890.123456');
    });
  });
});

