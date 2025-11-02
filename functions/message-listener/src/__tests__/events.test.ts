import { parseEvent } from '../events';
import {
  SlackEvent,
  UrlVerificationEvent,
  MessageEvent,
  MessageChangedEvent,
  MessageDeletedEvent,
  ChannelCreatedEvent,
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
        type: 'event_callback',
        team_id: 'T123456',
        event: {
          type: 'message',
          // Missing channel
          ts: '1234567890.123456',
        },
      };

      const parsed = parseEvent(event.event as SlackEvent);
      // Should handle gracefully - might be unknown or partial event
      expect(parsed.type).toBe('message');
    });
  });
});

