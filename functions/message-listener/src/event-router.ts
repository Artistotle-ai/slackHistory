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
  FileSharedEvent,
  logger,
} from "mnemosyne-slack-shared";
import { getMessageChannelId } from "mnemosyne-slack-shared";

// Lazy load handlers using dynamic imports for better cold start performance
// Handlers are only loaded when needed, reducing Lambda initialization time
let messageHandlersPromise: Promise<typeof import("./handlers/message-handlers")> | null = null;
let channelHandlersPromise: Promise<typeof import("./handlers/channel-handlers")> | null = null;

/**
 * Lazy load message handlers (only when processing message events)
 * Uses dynamic import to defer module loading until actually needed
 */
async function getMessageHandlers() {
  if (!messageHandlersPromise) {
    messageHandlersPromise = import("./handlers/message-handlers.js");
  }
  return messageHandlersPromise;
}

/**
 * Lazy load channel handlers (only when processing channel events)
 * Uses dynamic import to defer module loading until actually needed
 */
async function getChannelHandlers() {
  if (!channelHandlersPromise) {
    channelHandlersPromise = import("./handlers/channel-handlers.js");
  }
  return channelHandlersPromise;
}

export async function routeEvent(event: StrictSlackEvent): Promise<void> {
  // URL verification should be handled before routing
  if (event.type === "url_verification") {
    throw new Error("URL verification should be handled before routing");
  }

  // Handle unknown events
  if (event.type === "unknown" || !("team_id" in event)) {
    logger.debug(`Unknown event type: ${event.type}, ignoring`);
    return;
  }

  // Type guard: ensure team_id is a string
  // team_id is required for all events to identify the Slack workspace
  const teamId = typeof event.team_id === "string" ? event.team_id : "";
  if (!teamId) {
    logger.debug(`Event missing valid team_id, ignoring`);
    return;
  }

  // Handle message events - TypeScript narrows based on discriminated union
  // Message events can be: new message, edited (message_changed), or deleted (message_deleted)
  // Note: MessageChangedEvent doesn't have ts at top level, but we check for it or subtype
  if (event.type === "message" && ("ts" in event || "subtype" in event)) {
    // Type guard: check if it's a valid message event (not UnknownEvent)
    // Message events can have channel/channel_id in different formats depending on subtype
    if (("channel" in event || "channel_id" in event) && "team_id" in event) {
      const messageEvent = event as MessageEvent | MessageChangedEvent | MessageDeletedEvent;
      
      // Extract channel ID - helper function handles different event formats
      const extractedChannelId = getMessageChannelId(messageEvent);
      if (!extractedChannelId || typeof extractedChannelId !== "string") {
        logger.warn("Message event missing channel_id, skipping");
        return;
      }
      const channelId: string = extractedChannelId;

      // Route to specific handler based on message subtype
      // Check subtypes in order: changed -> deleted -> new message (default)
      // Lazy load message handlers only when processing message events
      const messageHandlers = await getMessageHandlers();
      
      if ("subtype" in messageEvent && messageEvent.subtype === "message_changed" && "message" in messageEvent) {
        // Message was edited - update existing message in DynamoDB
        await messageHandlers.handleMessageChanged(messageEvent as MessageChangedEvent, teamId, channelId);
      } else if ("subtype" in messageEvent && messageEvent.subtype === "message_deleted" && "deleted_ts" in messageEvent) {
        // Message was deleted - mark as deleted in DynamoDB (soft delete)
        await messageHandlers.handleMessageDeleted(messageEvent as MessageDeletedEvent, teamId, channelId);
      } else if ("ts" in messageEvent && typeof messageEvent.ts === "string") {
        // New message - create new entry in DynamoDB
        await messageHandlers.handleMessage(messageEvent as MessageEvent, teamId, channelId);
      }
    }
    return;
  }

  // Handle channel events - TypeScript exhaustively narrows based on discriminated union
  // All known channel event types are handled explicitly
  // Lazy load channel handlers only when processing channel events
  if (event.type !== "unknown") {
    switch (event.type) {
      case "channel_created": {
        const channelEvent = event as ChannelCreatedEvent;
        if ("channel" in channelEvent && typeof channelEvent.channel === "object" && "id" in channelEvent.channel) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelCreated(channelEvent, teamId);
        }
        return;
      }

      case "channel_rename": {
        const channelEvent = event as ChannelRenameEvent;
        if ("channel" in channelEvent && typeof channelEvent.channel === "object" && "id" in channelEvent.channel) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelRename(channelEvent, teamId);
        }
        return;
      }

      case "channel_deleted": {
        const channelEvent = event as ChannelDeletedEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelDeleted(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_archive": {
        const channelEvent = event as ChannelArchiveEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId && "user" in channelEvent) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelArchive(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_unarchive": {
        const channelEvent = event as ChannelUnarchiveEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId && "user" in channelEvent) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelUnarchive(channelEvent, teamId, channelId);
        }
        return;
      }

      case "channel_id_changed": {
        const channelEvent = event as ChannelIdChangedEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          const channelHandlers = await getChannelHandlers();
          const oldChannelId = channelEvent.previous_channel || channelId;
          await channelHandlers.handleChannelIdChanged(channelEvent, teamId, oldChannelId, channelId);
        }
        return;
      }

      case "channel_purpose": {
        const channelEvent = event as ChannelPurposeEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelPurposeOrTopic(channelEvent, teamId, channelId, "purpose");
        }
        return;
      }

      case "channel_topic": {
        const channelEvent = event as ChannelTopicEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelPurposeOrTopic(channelEvent, teamId, channelId, "topic");
        }
        return;
      }

      case "channel_convert_to_private": {
        const channelEvent = event as ChannelConvertToPrivateEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelVisibilityChange(channelEvent, teamId, channelId, "private");
        }
        return;
      }

      case "channel_convert_to_public": {
        const channelEvent = event as ChannelConvertToPublicEvent;
        const channelId = typeof channelEvent.channel === "string" ? channelEvent.channel : undefined;
        if (channelId) {
          const channelHandlers = await getChannelHandlers();
          await channelHandlers.handleChannelVisibilityChange(channelEvent, teamId, channelId, "public");
        }
        return;
      }

      case "file_shared": {
        const fileEvent = event as FileSharedEvent;
        // file_shared events are logged but not stored separately
        // Files are already captured via message.files field
        logger.debug(`File shared event: file_id=${fileEvent.file_id}, channel_id=${fileEvent.channel_id || 'N/A'}`);
        return;
      }
    }
  }
  
  // Unknown or unhandled event type
  logger.debug(`Unhandled event type in router: ${(event as { type: string }).type}, ignoring`);
}

