import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
  formatErrorMessage,
  logger,
} from "mnemosyne-slack-shared";
import { loadConfig, getOAuthCredentials } from "./config";
import { storeOAuthTokens } from "./dynamodb";
import { exchangeCodeForTokens, createOAuthTokenItem } from "./oauth";
import {
  getQueryParams,
  validateQueryParams,
  createSuccessResponse,
  createErrorResponse,
  getRedirectUri,
} from "./request-utils";

// Load config at module initialization
let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig();
} catch (error) {
  logger.error("Failed to load configuration", error);
  throw error;
}

/**
 * Main Lambda handler for OAuth callback
 */
export const handler = async (
  event: LambdaFunctionURLRequest
): Promise<LambdaFunctionURLResponse> => {
  try {
    // Extract and validate query parameters
    const queryParams = getQueryParams(event);
    let code: string;
    let state: string | undefined;

    try {
      ({ code, state } = validateQueryParams(queryParams));
    } catch (error) {
      logger.error("Query parameter validation failed", error);
      return createErrorResponse(400, formatErrorMessage(error));
    }

    // Security Note: OAuth redirect security model
    // Unlike webhooks, OAuth redirects don't include signature headers because
    // they're browser redirects, not API calls. Security comes from:
    // 1. Single-use codes: Slack codes can only be exchanged once
    // 2. redirect_uri validation: Slack validates redirect_uri matches app registration
    // 3. State parameter: Returned for CSRF protection (currently we validate it exists,
    //    but should validate against expected value in production for full CSRF protection)
    // 4. HTTPS: All communication over HTTPS prevents code interception
    //
    // Note: State validation is minimal in MVP - should enhance for production to:
    // - Store state value during OAuth initiation
    // - Validate state matches stored value here
    // - Reject requests with invalid/missing state

    // Get OAuth credentials from Secrets Manager (cached)
    // Credentials are needed to exchange authorization code for access token
    const credentials = await getOAuthCredentials(config);

    // Get redirect URI from environment variable
    // Must match the redirect_uri registered in Slack app settings
    const redirectUri = getRedirectUri();

    // Exchange authorization code for access/refresh tokens
    // This is the OAuth 2.0 token exchange step
    // Code is single-use and expires quickly (usually < 10 minutes)
    let oauthResponse;
    try {
      oauthResponse = await exchangeCodeForTokens(
        code,
        credentials.clientId,
        credentials.clientSecret,
        redirectUri
      );
    } catch (error) {
      // OAuth exchange failures are typically:
      // - Invalid/expired code (already used, too old)
      // - Invalid credentials (wrong client_id/secret)
      // - redirect_uri mismatch
      logger.error("OAuth exchange error", error);
      return createErrorResponse(
        401,
        `Unauthorized: Failed to exchange code for tokens - ${formatErrorMessage(error)}`
      );
    }

    // Create token item for DynamoDB storage
    // Includes access token, refresh token, expiration, team info
    const tokenItem = createOAuthTokenItem(oauthResponse);

    // Store tokens in DynamoDB
    // Tokens are stored per team_id - one token set per Slack workspace
    // Used by message-listener and file-processor to authenticate Slack API calls
    try {
      await storeOAuthTokens(config.tableName, tokenItem);
    } catch (error) {
      // DynamoDB write failures are critical - tokens must be stored
      // If write fails, user must restart OAuth flow
      logger.error("DynamoDB write error", error);
      return createErrorResponse(
        500,
        `Internal Server Error: Failed to store tokens - ${formatErrorMessage(error)}`
      );
    }

    logger.info(
      `Successfully stored OAuth tokens for team: ${tokenItem.team_id}`
    );

    // Return success response
    return createSuccessResponse();
  } catch (error) {
    logger.error("Unhandled error in OAuth callback", error);
    return createErrorResponse(
      500,
      `Internal Server Error: ${formatErrorMessage(error)}`
    );
  }
};

