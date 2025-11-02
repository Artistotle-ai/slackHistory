import {
  EventRepository,
  MessageEvent,
  MessageItem,
  getMessageItemId,
  getThreadParent,
  whitelistFileMetadata,
} from "mnemosyne-slack-shared";
import { loadConfig } from "./config";

/**
 * Message event repository factory
 * Creates a repository instance configured for message events
 */
export async function createMessageRepository(): Promise<EventRepository<MessageEvent, MessageItem>> {
  const config = await loadConfig();
  return new EventRepository<MessageEvent, MessageItem>({
    tableName: config.tableName,
    cacheTtl: 300, // 5 minutes cache
    
    toItem: (event: MessageEvent): MessageItem => {
      // Extract teamId and channelId from event (or helper functions)
      const teamId = event.team_id;
      const channelId = event.channel_id || event.channel;
      
      const itemId = getMessageItemId(teamId, channelId);
      const timestamp = event.ts;

      const item: MessageItem = {
        itemId,
        timestamp,
        type: "message",
        team_id: teamId,
        channel_id: channelId,
        ts: timestamp,
        raw_event: event,
      };

      if (event.text) item.text = event.text;
      if (event.user) item.user = event.user;
      
      // Thread logic: set parent if thread_ts is present
      if (event.thread_ts) {
        item.thread_ts = event.thread_ts;
        item.parent = getThreadParent(teamId, event.thread_ts);
      }
      
      if (event.files?.length) {
        item.files = event.files.map(whitelistFileMetadata);
      }

      return item;
    },
    
    getCacheKey: (event: MessageEvent): string => {
      return `message:${event.team_id}:${event.channel_id || event.channel}:${event.ts}`;
    },
    
    getItemId: (event: MessageEvent): string => {
      const teamId = event.team_id;
      const channelId = event.channel_id || event.channel;
      return getMessageItemId(teamId, channelId);
    },
    
    getSortKey: (event: MessageEvent): string => {
      return event.ts;
    },
  });
}

/**
 * Singleton instance for reuse across handler functions
 */
let messageRepositoryInstance: EventRepository<MessageEvent, MessageItem> | null = null;

export async function getMessageRepository(): Promise<EventRepository<MessageEvent, MessageItem>> {
  if (!messageRepositoryInstance) {
    messageRepositoryInstance = await createMessageRepository();
  }
  return messageRepositoryInstance;
}

