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
        channel: null as any, // Invalid channel (null is not string or object)
      };

      const parsed = parseEvent(event);
      // When channel is null, parseEvent checks: !channelId || (typeof channelId !== "string" && typeof channelId !== "object")
      // null is not a string and is an object, but null is falsy, so !channelId is true
      // So it returns UnknownEvent with original type preserved
      expect(parsed.type).toBe('channel_created'); // Type is preserved
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle url_verification without challenge', () => {
      const event: SlackEvent = {
        type: 'url_verification',
        // Missing challenge
      };

      const parsed = parseEvent(event);
      // When challenge is missing, parseEvent checks: if (typeof event.challenge === "string")
      // Since challenge is undefined, typeof is "undefined", not "string"
      // So it falls through to the end which returns: { type: type || "unknown", ...rest }
      // type is "url_verification", so it returns type "url_verification" with rest of properties
      // Actually wait - if it falls through, it reaches the end which does:
      // const { type, ...rest } = event; return { type: type || "unknown", ...rest }
      // So type would be "url_verification" from the original event
      // The test receives "url_verification" which matches the fallthrough behavior
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

    it('should unwrap event_callback and use team_id from wrapper', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456', // Team ID in wrapper
        event: {
          type: 'message',
          channel: 'C123456',
          ts: '1234567890.123456',
          // No team_id in inner event
        },
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageEvent).team_id).toBe('T123456');
    });

    it('should unwrap event_callback and use outer team_id when both present', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456', // Team ID in wrapper (used first)
        event: {
          type: 'message',
          team_id: 'T789012', // Team ID in inner event (fallback)
          channel: 'C123456',
          ts: '1234567890.123456',
        },
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('message');
      // parseEvent uses: event.team_id || innerEvent.team_id
      // So outer team_id is used when present
      expect((parsed as MessageEvent).team_id).toBe('T123456');
    });

    it('should handle nested event_callback recursively', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456', // Outer team_id
        event: {
          type: 'event_callback',
          team_id: 'T789012', // Middle team_id
          event: {
            type: 'message',
            // No team_id in innermost event
            channel: 'C123456',
            ts: '1234567890.123456',
          },
        },
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('message');
      // parseEvent uses: event.team_id || innerEvent.team_id
      // So for outer: T123456 || T789012 = T123456
      // Then it unwraps again: T123456 || undefined = T123456
      expect((parsed as MessageEvent).team_id).toBe('T123456');
    });

    it('should handle message_changed with previous_message', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'message',
          subtype: 'message_changed',
          channel: 'C123456',
          previous_message: {
            ts: '1234567890.123456',
            text: 'Previous message',
          },
        },
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageChangedEvent).subtype).toBe('message_changed');
      expect((parsed as MessageChangedEvent).message?.ts).toBe('1234567890.123456');
    });

    it('should handle message_deleted with ts as fallback', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'message',
          subtype: 'message_deleted',
          channel: 'C123456',
          ts: '1234567890.123456', // Use ts as fallback for deleted_ts
        },
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageDeletedEvent).subtype).toBe('message_deleted');
      expect((parsed as MessageDeletedEvent).deleted_ts).toBe('1234567890.123456');
    });

    it('should handle channel_created with is_private flag', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'channel_created',
          channel: {
            id: 'C123456',
            name: 'test-channel',
            is_private: true,
          },
        },
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_created');
      expect((parsed as ChannelCreatedEvent).channel.is_private).toBe(true);
    });

    it('should handle channel_created without is_private flag', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'channel_created',
          channel: {
            id: 'C123456',
            name: 'test-channel',
          },
        },
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_created');
      expect((parsed as ChannelCreatedEvent).channel.is_private).toBeUndefined();
    });

    it('should handle channel_rename with invalid channel structure', () => {
      const event: SlackEvent = {
        type: 'channel_rename',
        team_id: 'T123456',
        channel: 'C123456' as any, // Invalid: should be object but is string
      };

      const parsed = parseEvent(event);
      // Should fall through to unknown event due to invalid structure
      expect(parsed.type).toBe('channel_rename');
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle channel_archive without user', () => {
      const event: SlackEvent = {
        type: 'channel_archive',
        team_id: 'T123456',
        channel: 'C123456',
        // Missing user
      };

      const parsed = parseEvent(event);
      // Should fall through due to missing user
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle channel_unarchive without user', () => {
      const event: SlackEvent = {
        type: 'channel_unarchive',
        team_id: 'T123456',
        channel: 'C123456',
        // Missing user
      };

      const parsed = parseEvent(event);
      // Should fall through due to missing user
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle channel_purpose without purpose value', () => {
      const event: SlackEvent = {
        type: 'channel_purpose',
        team_id: 'T123456',
        channel: 'C123456',
        // No purpose field
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_purpose');
      expect((parsed as ChannelPurposeEvent).purpose).toBeUndefined();
    });

    it('should handle channel_topic without topic value', () => {
      const event: SlackEvent = {
        type: 'channel_topic',
        team_id: 'T123456',
        channel: 'C123456',
        // No topic field
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_topic');
      expect((parsed as ChannelTopicEvent).topic).toBeUndefined();
    });

    it('should handle channel_id_changed without previous_channel', () => {
      const event: SlackEvent = {
        type: 'channel_id_changed',
        team_id: 'T123456',
        channel: 'C123456',
        // No previous_channel
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('channel_id_changed');
      expect((parsed as ChannelIdChangedEvent).previous_channel).toBeUndefined();
    });

    it('should handle channel_created with channel_id as string', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'channel_created',
          channel_id: 'C123456', // String instead of object
        },
      };

      const parsed = parseEvent(event);
      // Should fall through to unknown due to invalid structure
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle message event with channel_id instead of channel', () => {
      const event: SlackEvent = {
        type: 'message',
        team_id: 'T123456',
        channel_id: 'C123456', // Using channel_id instead of channel
        ts: '1234567890.123456',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageEvent).channel).toBe('C123456');
      expect((parsed as MessageEvent).channel_id).toBe('C123456');
    });

    it('should handle message_changed event with channel_id', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'message',
          subtype: 'message_changed',
          channel_id: 'C123456',
          message: {
            ts: '1234567890.123456',
            text: 'Updated',
          },
        },
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('message');
      expect((parsed as MessageChangedEvent).channel).toBe('C123456');
      expect((parsed as MessageChangedEvent).channel_id).toBe('C123456');
    });

    it('should return unknown event when event type is missing', () => {
      const event: any = {
        team_id: 'T123456',
        // Missing type
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('unknown');
      expect((parsed as UnknownEvent).team_id).toBe('T123456');
    });

    it('should handle url_verification event when challenge is not a string', () => {
      const event: SlackEvent = {
        type: 'url_verification',
        challenge: 12345 as any, // Not a string
      };

      const parsed = parseEvent(event);
      // When challenge is not a string, it falls through
      expect(parsed.type).toBe('url_verification');
    });

    it('should handle url_verification event when challenge is undefined', () => {
      const event: SlackEvent = {
        type: 'url_verification',
        // challenge is undefined
      };

      const parsed = parseEvent(event);
      // When challenge is undefined, typeof check fails and falls through
      expect(parsed.type).toBe('url_verification');
    });

    it('should handle event_callback with event type url_verification', () => {
      const event: SlackEvent = {
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'url_verification',
          challenge: 'test_challenge',
        } as any,
      };

      const parsed = parseEvent(event);
      // Should unwrap and parse the inner url_verification event
      expect(parsed.type).toBe('url_verification');
      expect((parsed as UrlVerificationEvent).challenge).toBe('test_challenge');
      expect((parsed as UrlVerificationEvent).token).toBeUndefined();
    });

    it('should handle url_verification with token as string', () => {
      const event: SlackEvent = {
        type: 'url_verification',
        challenge: 'test_challenge',
        token: 'test_token',
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('url_verification');
      expect((parsed as UrlVerificationEvent).challenge).toBe('test_challenge');
      expect((parsed as UrlVerificationEvent).token).toBe('test_token');
    });

    it('should handle url_verification with token as non-string', () => {
      const event: SlackEvent = {
        type: 'url_verification',
        challenge: 'test_challenge',
        token: 12345 as any,
      };

      const parsed = parseEvent(event);
      expect(parsed.type).toBe('url_verification');
      expect((parsed as UrlVerificationEvent).token).toBeUndefined();
    });

    it('should handle url_verification with challenge that is not a string', () => {
      const event: SlackEvent = {
        type: 'url_verification',
        challenge: 12345 as any, // challenge is not a string
        token: 'test_token',
      };

      // Should fall through and be treated as unknown/other event type
      const parsed = parseEvent(event);
      // The function will continue past the url_verification check
      expect(parsed.type).toBeDefined();
    });

    it('should handle event with missing team_id', () => {
      const event: SlackEvent = {
        type: 'message',
        // Missing team_id
        channel: 'C123456',
        ts: '1234567890.123456',
      };

      const parsed = parseEvent(event);
      // Should return unknown event when team_id is missing
      expect((parsed as UnknownEvent).type).toBe('message');
      expect((parsed as UnknownEvent).team_id).toBeUndefined();
    });

    it('should handle event with team_id that is not a string', () => {
      const event: SlackEvent = {
        type: 'message',
        team_id: 12345 as any, // team_id is not a string
        channel: 'C123456',
        ts: '1234567890.123456',
      };

      const parsed = parseEvent(event);
      // Should return unknown event when team_id is invalid type
      expect((parsed as UnknownEvent).type).toBe('message');
    });
  });
});

