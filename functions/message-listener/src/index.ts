import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
  SlackEvent,
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
let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig();
} catch (error) {
  console.error("Failed to load configuration:", error);
  throw error;
}

/**
 * Main Lambda handler for Function URL
 */
export const handler = async (
  request: LambdaFunctionURLRequest
): Promise<LambdaFunctionURLResponse> => {
  try {
    // Parse request body
    let parsedEvent: SlackEvent;
    try {
      parsedEvent = parseRequestBody(request);
    } catch (error) {
      console.error("Invalid JSON in request body:", error);
      return createErrorResponse(400, "Bad Request: Invalid JSON");
    }

    // Handle URL verification challenge (before signature verification)
    if (parsedEvent.type === "url_verification" && parsedEvent.challenge) {
      console.log("Handling URL verification challenge");
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
      console.error("Missing Slack signature headers");
      return createErrorResponse(401, "Unauthorized");
    }

    // Get raw body for signature verification
    let body = request.body || "{}";
    if (request.isBase64Encoded && body) {
      body = Buffer.from(body, "base64").toString("utf-8");
    }

    const signingSecret = await getSigningSecret(config);
    if (!verifySlackSignature(signingSecret, signature, timestamp, body)) {
      console.error("Invalid Slack signature");
      return createErrorResponse(401, "Unauthorized");
    }

    // Parse event into strict type and route
    const strictEvent = parseEvent(parsedEvent);
    await routeEvent(strictEvent);

    return createSuccessResponse();
  } catch (error) {
    // Return 200 to prevent Slack retries (requirements: log errors but avoid duplicates)
    console.error("Error processing event:", error);
    return createSuccessResponse();
  }
};