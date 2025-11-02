import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
  SlackEvent,
  formatErrorMessage,
  logger,
} from "mnemosyne-slack-shared";
import { verifySlackSignature } from "mnemosyne-slack-shared";
import { loadConfig, getSigningSecret } from "./config";
import { parseEvent } from "./events";
import { routeEvent } from "./event-router";
import {
  handleUrlVerification,
  parseRequestBody,
  extractSignatureHeaders,
  createErrorResponse,
  createSuccessResponse,
} from "./request-utils";

// Load config at module initialization
// Note: Cannot use top-level await, so config is loaded in handler
// For now, we'll load it on first handler invocation
let config: Awaited<ReturnType<typeof loadConfig>> | null = null;

/**
 * Main Lambda handler for Function URL
 */
export const handler = async (
  request: LambdaFunctionURLRequest
): Promise<LambdaFunctionURLResponse> => {
  try {
    // Load config if not already loaded (singleton pattern per Lambda execution)
    if (!config) {
      try {
        config = await loadConfig();
      } catch (error) {
        logger.error("Failed to load configuration", error);
        throw error;
      }
    }

    // Parse request body
    let parsedEvent: SlackEvent;
    try {
      parsedEvent = parseRequestBody(request);
    } catch (error) {
      logger.error("Invalid JSON in request body", error);
      return createErrorResponse(400, "Bad Request: Invalid JSON");
    }

    // Handle URL verification challenge (before signature verification)
    if (parsedEvent.type === "url_verification" && parsedEvent.challenge) {
      logger.debug("Handling URL verification challenge");
      return handleUrlVerification(parsedEvent as { type: "url_verification"; challenge: string });
    }

    // Verify Slack signature for all other events
    let signature: string;
    let timestamp: string;
    try {
      const headers = extractSignatureHeaders(request);
      signature = headers.signature;
      timestamp = headers.timestamp;
    } catch (error) {
      logger.error("Missing Slack signature headers");
      return createErrorResponse(401, "Unauthorized");
    }

    // Get raw body for signature verification
    // Signature verification requires the original, unparsed request body
    // Lambda Function URLs may base64-encode the body, so we decode if needed
    let body = request.body || "{}";
    if (request.isBase64Encoded && body) {
      // Decode base64-encoded body to get original string
      // This is necessary because Lambda Function URLs encode binary data
      body = Buffer.from(body, "base64").toString("utf-8");
    }

    // Verify Slack request signature
    // This prevents unauthorized requests and ensures message integrity
    // Signature is HMAC-SHA256 of timestamp + body, using signing secret
    const signingSecret = await getSigningSecret(config);
    if (!verifySlackSignature(signingSecret, signature, timestamp, body)) {
      logger.error("Invalid Slack signature");
      return createErrorResponse(401, "Unauthorized");
    }

    // Parse event into strict type and route
    const strictEvent = parseEvent(parsedEvent);
    try {
      await routeEvent(strictEvent);
    } catch (error) {
      // DynamoDB errors or processing errors - return 500
      // Slack will retry, but handlers should be idempotent to handle duplicates
      logger.error("Error routing/processing event", error);
      return createErrorResponse(500, `Internal Server Error: ${formatErrorMessage(error)}`);
    }

    return createSuccessResponse();
  } catch (error) {
    // Unexpected errors (shouldn't happen but handle gracefully)
    logger.error("Unexpected error processing event", error);
    // Return 500 for unexpected errors
    return createErrorResponse(500, `Internal Server Error: ${formatErrorMessage(error)}`);
  }
};