// Lazy load crypto module (only when needed)
let cryptoModule: typeof import("crypto") | null = null;

function getCrypto() {
  if (!cryptoModule) {
    cryptoModule = require("crypto") as typeof import("crypto");
  }
  return cryptoModule;
}
import { SlackFile, SlackFileMetadata } from "../config/types";

/**
 * Verify Slack request signature
 * @param signingSecret - Slack signing secret
 * @param signature - X-Slack-Signature header value
 * @param timestamp - X-Slack-Request-Timestamp header value
 * @param body - Raw request body string
 * @returns true if signature is valid
 */
export function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  // Reject requests older than 10 minutes to prevent replay attacks
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(currentTime - requestTime) > 600) {
    return false;
  }

  // Create the signature base string
  const sigBaseString = `v0:${timestamp}:${body}`;
  
  // Lazy load crypto when needed
  const crypto = getCrypto();
  
  // Create the signature
  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(sigBaseString);
  const computedSignature = `v0=${hmac.digest("hex")}`;

  // Use constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}

/**
 * Whitelist file metadata fields to reduce storage footprint
 */
export function whitelistFileMetadata(file: SlackFile): SlackFileMetadata {
  return {
    id: file.id,
    ...(file.name && { name: file.name }),
    ...(file.title && { title: file.title }),
    ...(file.mimetype && { mimetype: file.mimetype }),
    ...(file.filetype && { filetype: file.filetype }),
    ...(file.size && { size: file.size }),
    ...(file.url_private && { url_private: file.url_private }),
    ...(file.mode && { mode: file.mode }),
    ...(file.is_external !== undefined && { is_external: file.is_external }),
    ...(file.created && { created: file.created }),
    ...(file.user && { user: file.user }),
  };
}

/**
 * Extract channel ID from a message event
 */
export function getMessageChannelId(event: { channel?: string; channel_id?: string }): string | undefined {
  return event.channel || event.channel_id;
}

/**
 * Extract channel ID from a channel event
 */
export function getChannelEventChannelId(
  event:
    | { type: "channel_created" | "channel_rename"; channel: { id: string } }
    | { type: string; channel: string }
): string {
  if (typeof event.channel === "string") {
    return event.channel;
  }
  return event.channel.id;
}

