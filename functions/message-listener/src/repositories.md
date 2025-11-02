# Event Repository Pattern - Usage Guide

## Overview

The `EventRepository` pattern provides a reusable way to handle DynamoDB operations for different event types. Each repository encapsulates:
- Event-to-item transformation (`toItem`)
- Cache key generation (`getCacheKey`)
- Common operations (save, get, update, cache)

## Setup

### 1. Create a Repository Factory

In `repositories.ts`:

```typescript
import { EventRepository, MessageEvent, MessageItem } from "mnemosyne-slack-shared";
import { loadConfig } from "./config";

const config = loadConfig();

export function createMessageRepository(): EventRepository<MessageEvent, MessageItem> {
  return new EventRepository<MessageEvent, MessageItem>({
    tableName: config.tableName,
    cacheTtl: 300, // 5 minutes cache
    
    toItem: (event: MessageEvent): MessageItem => {
      // Your transformation logic here
      const teamId = event.team_id;
      const channelId = event.channel_id || event.channel;
      
      return {
        itemId: `message#${teamId}#${channelId}`,
        timestamp: event.ts,
        type: "message",
        team_id: teamId,
        channel_id: channelId,
        ts: event.ts,
        raw_event: event,
        // ... other fields
      };
    },
    
    getCacheKey: (event: MessageEvent): string => {
      return `message:${event.team_id}:${event.channel_id}:${event.ts}`;
    },
  });
}

// Singleton pattern for reuse
let messageRepositoryInstance: EventRepository<MessageEvent, MessageItem> | null = null;

export function getMessageRepository(): EventRepository<MessageEvent, MessageItem> {
  if (!messageRepositoryInstance) {
    messageRepositoryInstance = createMessageRepository();
  }
  return messageRepositoryInstance;
}
```

### 2. Use in Handlers

In your handler files:

```typescript
import { getMessageRepository } from "../repositories";

const messageRepo = getMessageRepository();

export async function handleMessage(
  event: MessageEvent,
  teamId: string,
  channelId: string
): Promise<void> {
  // Save to DB (with optional caching)
  await messageRepo.save(event);
  
  // Or get from cache/DB
  const item = await messageRepo.getCached(event);
  
  // Or update
  await messageRepo.update(event, "SET text = :text", { ":text": "Updated" });
}
```

## When to Use

**Use the repository pattern when:**
- You have multiple similar data types
- You need consistent caching behavior
- You want to reduce duplication in DynamoDB operations

**Keep existing code when:**
- The transformation is very simple
- You only have one operation per event type
- The performance overhead isn't worth it

## Complete Example

See `functions/message-listener/src/repositories.ts` for a full working example.

