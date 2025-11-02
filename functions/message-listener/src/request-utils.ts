import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
  SlackEvent,
  UrlVerificationEvent,
  parseRequestBody as parseRequestBodyShared,
  createErrorResponse as createErrorResponseShared,
  createSuccessJsonResponse,
} from "mnemosyne-slack-shared";

/**
 * Handle URL verification challenge from Slack
 */
export function handleUrlVerification(
  event: UrlVerificationEvent | { type: "url_verification"; challenge: string }
): LambdaFunctionURLResponse {
  return createSuccessJsonResponse({ challenge: event.challenge });
}

/**
 * Parse and validate request body as SlackEvent
 */
export function parseRequestBody(
  request: LambdaFunctionURLRequest
): SlackEvent {
  return parseRequestBodyShared(request) as SlackEvent;
}

/**
 * Extract and validate Slack signature headers
 */
export function extractSignatureHeaders(request: LambdaFunctionURLRequest): {
  signature: string;
  timestamp: string;
} {
  const headers = request.headers || {};
  const signature = headers["x-slack-signature"] || headers["X-Slack-Signature"];
  const timestamp =
    headers["x-slack-request-timestamp"] || headers["X-Slack-Request-Timestamp"];

  if (!signature || !timestamp) {
    throw new Error("Missing Slack signature headers");
  }

  return { signature, timestamp };
}

// Re-export shared utilities
export { createErrorResponseShared as createErrorResponse };
export function createSuccessResponse(): LambdaFunctionURLResponse {
  return createSuccessJsonResponse();
}

