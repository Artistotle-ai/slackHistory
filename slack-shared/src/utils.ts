import * as crypto from "crypto";
import { SlackFile, SlackFileMetadata } from "./types";

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
  // Reject requests older than 5 minutes to prevent replay attacks
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(currentTime - requestTime) > 300) {
    return false;
  }

  // Create the signature base string
  const sigBaseString = `v0:${timestamp}:${body}`;
  
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
 * Cap array at maximum length, keeping the most recent entries
 */
export function capArray<T>(array: T[], maxLength: number): T[] {
  if (array.length <= maxLength) {
    return array;
  }
  return array.slice(-maxLength);
}

/**
 * Generate DynamoDB itemId for messages
 */
export function getMessageItemId(teamId: string, channelId: string): string {
  return `message#${teamId}#${channelId}`;
}

/**
 * Generate DynamoDB itemId for channels
 */
export function getChannelItemId(teamId: string, channelId: string): string {
  return `channel#${teamId}#${channelId}`;
}

/**
 * Generate parent attribute for thread messages
 */
export function getThreadParent(teamId: string, threadTs: string): string {
  return `thread#${teamId}#${threadTs}`;
}

