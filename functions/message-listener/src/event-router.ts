import {
  StrictSlackEvent,
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
} from "mnemosyne-slack-shared";
import { getMessageChannelId } from "mnemosyne-slack-shared";
import * as messageHandlers from "./handlers/message-handlers";
import * as channelHandlers from "./handlers/channel-handlers";

/**
 * Route event to appropriate handler using discriminated union narrowing
 */
export async function routeEvent(event: StrictSlackEvent): Promise<void> {
  // URL verification should be handled before routing
  if (event.type === "url_verification") {
    throw new Error("URL verification should be handled before routing");
  }

  // Handle unknown events
  if (event.type === "unknown" || !("team_id" in event)) {
    console.log(`Unknown event type: ${event.type}, ignoring`);
    return;
  }

  // Type guard: ensure team_id is a string
  const teamId = typeof event.team_id === "string" ? event.team_id : "";
  if (!teamId) {
    console.log(`Event missing valid team_id, ignoring`);
    return;
  }

  // Handle message events - TypeScript narrows based on discriminated union
  if (event.type === "message" && "ts" in event) {
    // Type guard: check if it's a valid message event (not UnknownEvent)
    if (("channel" in event || "channel_id" in event) && "team_id" in event) {
      const messageEvent = event as MessageEvent | MessageChangedEvent | MessageDeletedEvent;
      const extractedChannelId = getMessageChannelId(messageEvent);
      if (!extractedChannelId || typeof extractedChannelId !== "string") {
        console.warn("Message event missing channel_id, skipping");
        return;
      }
      const channelId: string = extractedChannelId;

      // Narrow by subtype
      if ("subtype" in messageEvent && messageEvent.subtype === "message_changed" && "message" in messageEvent) {
        await messageHandlers.handleMessageChanged(messageEvent as MessageChangedEvent, teamId, channelId);
      } else if ("subtype" in messageEvent && messageEvent.subtype === "message_deleted" && "deleted_ts" in messageEvent) {
        await messageHandlers.handleMessageDeleted(messageEvent as MessageDeletedEvent, teamId, channelId);
      } else if ("ts" in messageEvent && typeof messageEvent.ts === "string") {
        await messageHandlers.handleMessage(messageEvent as MessageEvent, teamId, channelId);
      }
    }
    return;
  }

  // Handle channel events - TypeScript exhaustively narrows based on discriminated union
  // All known channel event types are handled explicitly
  if (event.type !== "unknown") {
    switch (event.type) {
      case "channel_created": {
        const channelEvent = event as ChannelCreatedEvent;
        if ("channel" in channelEvent && typeof channelEvent.channel === "object" && "id" in channelEvent.channel) {
          await channelHandlers.handleChannelCreated(channelEvent, teamId);
        }
        return;
      }

      case "channel_rename": {
        const channelEvent = event as ChannelRenameEvent;
        if ("channel" in channelEvent && typeof channelEvent.channel === "object" && "id" in channelEvent.channel) {
          await channelHandlers.handleChannelRename(channelEvent, teamId);
        }
        return;
      }

      case "channel_deleted": {
        const channelEvent = event as ChannelDeletedEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await channelHandlers.handleChannelDeleted(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_archive": {
        const channelEvent = event as ChannelArchiveEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId && "user" in channelEvent) {
          await channelHandlers.handleChannelArchive(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_unarchive": {
        const channelEvent = event as ChannelUnarchiveEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId && "user" in channelEvent) {
          await channelHandlers.handleChannelUnarchive(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_id_changed": {
        const channelEvent = event as ChannelIdChangedEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          const oldChannelId = channelEvent.previous_channel || channelId;
          await channelHandlers.handleChannelIdChanged(channelEvent, teamId, oldChannelId, channelId);
        }
        return;
      }

      case "channel_purpose": {
        const channelEvent = event as ChannelPurposeEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await channelHandlers.handleChannelPurposeOrTopic(channelEvent, teamId, channelId, "purpose");
        }
        return;
      }

      case "channel_topic": {
        const channelEvent = event as ChannelTopicEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await channelHandlers.handleChannelPurposeOrTopic(channelEvent, teamId, channelId, "topic");
        }
        return;
      }

      case "channel_convert_to_private": {
        const channelEvent = event as ChannelConvertToPrivateEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await channelHandlers.handleChannelVisibilityChange(channelEvent, teamId, channelId, "private");
        }
        return;
      }

      case "channel_convert_to_public": {
        const channelEvent = event as ChannelConvertToPublicEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          await channelHandlers.handleChannelVisibilityChange(channelEvent, teamId, channelId, "public");
        }
        return;
      }
    }
  }
  
  // Unknown or unhandled event type
  console.log(`Unhandled event type in router: ${(event as { type: string }).type}, ignoring`);
}

