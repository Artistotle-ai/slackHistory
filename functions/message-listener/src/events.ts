import {
  SlackEvent,
  StrictSlackEvent,
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
} from "mnemosyne-slack-shared";

/**
 * Parse and validate a Slack event into a strict event type
 */
export function parseEvent(event: SlackEvent): StrictSlackEvent {
  // Handle URL verification
  if (event.type === "url_verification") {
    if (typeof event.challenge === "string") {
      return {
        type: "url_verification",
        challenge: event.challenge,
        token: typeof event.token === "string" ? event.token : undefined,
      };
    }
  }

  // Unwrap event_callback envelope
  // Slack wraps actual events in an event_callback envelope with the real event nested inside
  if (event.type === "event_callback" && event.event && typeof event.event === "object") {
    // Extract team_id from wrapper and merge with inner event
    const innerEvent = event.event as SlackEvent;
    const team_id = event.team_id || innerEvent.team_id;
    // Recursively parse the inner event
    return parseEvent({ ...innerEvent, team_id } as SlackEvent);
  }

  // Validate team_id is present for all other events
  if (!event.team_id || typeof event.team_id !== "string") {
    const { type, ...rest } = event;
    return { type: type || "unknown", ...rest } as UnknownEvent;
  }

  // Handle message events
  if (event.type === "message") {
    const channel = event.channel || event.channel_id;
    if (!channel || typeof channel !== "string") {
      const { type, team_id, ...rest } = event;
      return { type, team_id, ...rest } as UnknownEvent;
    }

    if (event.subtype === "message_changed") {
      const message = event.message || event.previous_message;
      if (message && typeof message.ts === "string") {
        return {
          type: "message",
          subtype: "message_changed",
          team_id: event.team_id,
          channel,
          channel_id: event.channel_id,
          message: message,
          previous_message: event.previous_message,
          edited: event.edited,
          event_ts: event.event_ts,
        } as MessageChangedEvent;
      }
    }

    if (event.subtype === "message_deleted") {
      const deletedTs = event.deleted_ts || event.ts;
      if (typeof deletedTs === "string") {
        return {
          type: "message",
          subtype: "message_deleted",
          team_id: event.team_id,
          channel,
          channel_id: event.channel_id,
          deleted_ts: deletedTs,
          ts: event.ts,
          event_ts: event.event_ts,
        } as MessageDeletedEvent;
      }
    }

    // Regular message event
    const ts = event.ts || event.event_ts;
    if (typeof ts === "string") {
      return {
        type: "message",
        team_id: event.team_id,
        channel,
        channel_id: event.channel_id,
        ts,
        subtype: event.subtype,
        user: event.user,
        text: event.text,
        thread_ts: event.thread_ts,
        files: event.files,
        event_ts: event.event_ts,
      } as MessageEvent;
    }
  }

  // Handle channel events - check each channel event type explicitly (no startsWith)
  const isChannelEvent = (type: string): type is
    | "channel_created"
    | "channel_rename"
    | "channel_deleted"
    | "channel_archive"
    | "channel_unarchive"
    | "channel_id_changed"
    | "channel_purpose"
    | "channel_topic"
    | "channel_convert_to_private"
    | "channel_convert_to_public" => {
    return (
      type === "channel_created" ||
      type === "channel_rename" ||
      type === "channel_deleted" ||
      type === "channel_archive" ||
      type === "channel_unarchive" ||
      type === "channel_id_changed" ||
      type === "channel_purpose" ||
      type === "channel_topic" ||
      type === "channel_convert_to_private" ||
      type === "channel_convert_to_public"
    );
  };

  if (typeof event.type === "string" && isChannelEvent(event.type)) {
    const channelId = event.channel || event.channel_id;
    if (!channelId || (typeof channelId !== "string" && typeof channelId !== "object")) {
      const { type, team_id, ...rest } = event;
      return { type, team_id, ...rest } as UnknownEvent;
    }

    switch (event.type) {
      case "channel_created": {
        const channelObj = event.channel as unknown;
        if (
          channelObj &&
          typeof channelObj === "object" &&
          "id" in channelObj &&
          "name" in channelObj
        ) {
          return {
            type: "channel_created",
            team_id: event.team_id,
            channel: {
              id: String(channelObj.id),
              name: String(channelObj.name),
              is_private:
                "is_private" in channelObj
                  ? Boolean(channelObj.is_private)
                  : undefined,
            },
            event_ts: event.event_ts,
          } as ChannelCreatedEvent;
        }
        break;
      }

      case "channel_rename": {
        const channelObj = event.channel as unknown;
        if (
          channelObj &&
          typeof channelObj === "object" &&
          "id" in channelObj &&
          "name" in channelObj
        ) {
          return {
            type: "channel_rename",
            team_id: event.team_id,
            channel: {
              id: String(channelObj.id),
              name: String(channelObj.name),
            },
            event_ts: event.event_ts,
          } as ChannelRenameEvent;
        }
        break;
      }

      case "channel_deleted":
        return {
          type: "channel_deleted",
          team_id: event.team_id,
          channel: channelId,
          event_ts: event.event_ts,
        } as ChannelDeletedEvent;

      case "channel_archive":
        if (typeof event.user === "string") {
          return {
            type: "channel_archive",
            team_id: event.team_id,
            channel: channelId,
            user: event.user,
            event_ts: event.event_ts,
          } as ChannelArchiveEvent;
        }
        break;

      case "channel_unarchive":
        if (typeof event.user === "string") {
          return {
            type: "channel_unarchive",
            team_id: event.team_id,
            channel: channelId,
            user: event.user,
            event_ts: event.event_ts,
          } as ChannelUnarchiveEvent;
        }
        break;

      case "channel_id_changed":
        return {
          type: "channel_id_changed",
          team_id: event.team_id,
          channel: channelId,
          previous_channel: typeof event.previous_channel === "string" ? event.previous_channel : undefined,
          event_ts: event.event_ts,
        } as ChannelIdChangedEvent;

      case "channel_purpose":
        return {
          type: "channel_purpose",
          team_id: event.team_id,
          channel: channelId,
          purpose: typeof event.purpose === "string" ? event.purpose : undefined,
          event_ts: event.event_ts,
        } as ChannelPurposeEvent;

      case "channel_topic":
        return {
          type: "channel_topic",
          team_id: event.team_id,
          channel: channelId,
          topic: typeof event.topic === "string" ? event.topic : undefined,
          event_ts: event.event_ts,
        } as ChannelTopicEvent;

      case "channel_convert_to_private":
        return {
          type: "channel_convert_to_private",
          team_id: event.team_id,
          channel: channelId,
          event_ts: event.event_ts,
        } as ChannelConvertToPrivateEvent;

      case "channel_convert_to_public":
        return {
          type: "channel_convert_to_public",
          team_id: event.team_id,
          channel: channelId,
          event_ts: event.event_ts,
        } as ChannelConvertToPublicEvent;
    }
  }

  // Unknown event type
  const { type, ...rest } = event;
  return { type: type || "unknown", ...rest } as UnknownEvent;
}
