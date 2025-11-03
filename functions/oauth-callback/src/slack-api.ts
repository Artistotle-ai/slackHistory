import { logger } from "mnemosyne-slack-shared";

interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  is_archived: boolean;
}

interface ConversationsListResponse {
  ok: boolean;
  channels: SlackChannel[];
  response_metadata?: {
    next_cursor?: string;
  };
  error?: string;
}

interface ConversationJoinResponse {
  ok: boolean;
  channel?: {
    id: string;
    name: string;
  };
  error?: string;
}

/**
 * Join all public channels in the workspace
 * This is called after OAuth install to ensure the bot can archive all messages
 */
export async function joinAllPublicChannels(botToken: string): Promise<void> {
  let cursor: string | undefined;
  let totalJoined = 0;
  let totalSkipped = 0;

  do {
    // List public channels (paginated)
    const listUrl = new URL("https://slack.com/api/conversations.list");
    listUrl.searchParams.set("types", "public_channel");
    listUrl.searchParams.set("exclude_archived", "true");
    listUrl.searchParams.set("limit", "200");
    if (cursor) {
      listUrl.searchParams.set("cursor", cursor);
    }

    const listResponse = await fetch(listUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!listResponse.ok) {
      throw new Error(`Slack API returned status ${listResponse.status}`);
    }

    const listData = await listResponse.json() as ConversationsListResponse;

    if (!listData.ok) {
      throw new Error(`Slack API error: ${listData.error || "Unknown error"}`);
    }

    // Join each channel that we're not already a member of
    for (const channel of listData.channels) {
      if (!channel.is_member && !channel.is_archived) {
        try {
          await joinChannel(botToken, channel.id);
          logger.info(`Joined channel: ${channel.name} (${channel.id})`);
          totalJoined++;
        } catch (error) {
          logger.warn(`Failed to join channel ${channel.name}:`, error);
        }
      } else {
        totalSkipped++;
      }
    }

    cursor = listData.response_metadata?.next_cursor;
  } while (cursor);

  logger.info(`Auto-join complete: ${totalJoined} channels joined, ${totalSkipped} already joined/skipped`);
}

/**
 * Join a specific channel
 */
async function joinChannel(botToken: string, channelId: string): Promise<void> {
  const response = await fetch("https://slack.com/api/conversations.join", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack API returned status ${response.status}`);
  }

  const data = await response.json() as ConversationJoinResponse;

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || "Unknown error"}`);
  }
}
