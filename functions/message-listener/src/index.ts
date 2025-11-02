import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
  SlackEvent,
  formatErrorMessage,
  logger,
} from "mnemosyne-slack-shared";

// Lazy load modules for better cold start performance
// Only load what's needed when it's actually used
let verifySlackSignatureFn: typeof import("mnemosyne-slack-shared")["verifySlackSignature"] | null = null;
let configModule: typeof import("./config") | null = null;
let eventsModule: typeof import("./events") | null = null;
let eventRouterModule: typeof import("./event-router") | null = null;
let requestUtilsModule: typeof import("./request-utils") | null = null;

/**
 * Lazy load verifySlackSignature (only when signature verification is needed)
 */
async function getVerifySlackSignature() {
  if (!verifySlackSignatureFn) {
    const sharedModule = await import("mnemosyne-slack-shared");
    verifySlackSignatureFn = sharedModule.verifySlackSignature;
  }
  return verifySlackSignatureFn;
}

/**
 * Lazy load config module (only when needed)
 */
async function getConfigModule() {
  if (!configModule) {
    configModule = await import("./config.js");
  }
  return configModule;
}

/**
 * Lazy load events module (only when parsing events)
 */
async function getEventsModule() {
  if (!eventsModule) {
    eventsModule = await import("./events.js");
  }
  return eventsModule;
}

/**
 * Lazy load event router (only when routing events)
 */
async function getEventRouterModule() {
  if (!eventRouterModule) {
    eventRouterModule = await import("./event-router.js");
  }
  return eventRouterModule;
}

/**
 * Lazy load request utils (only when processing requests)
 */
async function getRequestUtilsModule() {
  if (!requestUtilsModule) {
    requestUtilsModule = await import("./request-utils.js");
  }
  return requestUtilsModule;
}

// Load config at handler initialization (lazy loaded)
let config: any = null;

/**
 * Main Lambda handler for Function URL
 */
export const handler = async (
  request: LambdaFunctionURLRequest
): Promise<LambdaFunctionURLResponse> => {
  try {
    // Lazy load request utils first (needed for basic request handling)
    const requestUtils = await getRequestUtilsModule();
    
    // Load config if not already loaded (singleton pattern per Lambda execution)
    if (!config) {
      try {
        const configMod = await getConfigModule();
        config = await configMod.loadConfig();
      } catch (error) {
        logger.error("Failed to load configuration", error);
        throw error;
      }
    }

    // Parse request body (lazy load events module only when parsing)
    let parsedEvent: SlackEvent;
    try {
      parsedEvent = requestUtils.parseRequestBody(request);
    } catch (error) {
      logger.error("Invalid JSON in request body", error);
      return requestUtils.createErrorResponse(400, "Bad Request: Invalid JSON");
    }

    // Handle URL verification challenge (before signature verification)
    if (parsedEvent.type === "url_verification" && parsedEvent.challenge) {
      logger.debug("Handling URL verification challenge");
      return requestUtils.handleUrlVerification(parsedEvent as { type: "url_verification"; challenge: string });
    }

    // Verify Slack signature for all other events
    let signature: string;
    let timestamp: string;
    try {
      const headers = requestUtils.extractSignatureHeaders(request);
      signature = headers.signature;
      timestamp = headers.timestamp;
    } catch (error) {
      logger.error("Missing Slack signature headers");
      return requestUtils.createErrorResponse(401, "Unauthorized");
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

    // Verify Slack request signature (lazy load signature verification)
    // This prevents unauthorized requests and ensures message integrity
    // Signature is HMAC-SHA256 of timestamp + body, using signing secret
    const configMod = await getConfigModule();
    const signingSecret = await configMod.getSigningSecret(config);
    const verifySignature = await getVerifySlackSignature();
    if (!verifySignature(signingSecret, signature, timestamp, body)) {
      logger.error("Invalid Slack signature");
      return requestUtils.createErrorResponse(401, "Unauthorized");
    }

    // Parse event into strict type and route (lazy load events and router modules)
    const eventsMod = await getEventsModule();
    const strictEvent = eventsMod.parseEvent(parsedEvent);
    try {
      const routerMod = await getEventRouterModule();
      await routerMod.routeEvent(strictEvent);
    } catch (error) {
      // DynamoDB errors or processing errors - return 500
      // Slack will retry, but handlers should be idempotent to handle duplicates
      logger.error("Error routing/processing event", error);
      return requestUtils.createErrorResponse(500, `Internal Server Error: ${formatErrorMessage(error)}`);
    }

    return requestUtils.createSuccessResponse();
  } catch (error) {
    // Unexpected errors (shouldn't happen but handle gracefully)
    logger.error("Unexpected error processing event", error);
    // Return 500 for unexpected errors (lazy load request utils if needed)
    try {
      const requestUtils = await getRequestUtilsModule();
      return requestUtils.createErrorResponse(500, `Internal Server Error: ${formatErrorMessage(error)}`);
    } catch {
      // Fallback if request utils can't be loaded (shouldn't happen)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Internal Server Error" }),
        headers: { "Content-Type": "application/json" },
      };
    }
  }
};