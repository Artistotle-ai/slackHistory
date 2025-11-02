import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
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
  console.error("Failed to load configuration:", error);
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
    let state: string;
    
    try {
      ({ code, state } = validateQueryParams(queryParams));
    } catch (error) {
      console.error("Query parameter validation failed:", error);
      return createErrorResponse(400, error instanceof Error ? error.message : String(error));
    }

    // Note: For OAuth redirects, Slack validates:
    // 1. The redirect_uri matches what's registered in the app
    // 2. The code can only be exchanged once (Slack enforces this)
    // 3. The state parameter is returned for CSRF protection (we validate it exists)
    // Unlike webhooks, OAuth redirects don't include signature headers because
    // they're browser redirects, not API calls. Security comes from:
    // - Single-use codes enforced by Slack
    // - redirect_uri validation by Slack
    // - State parameter for CSRF protection (should be validated against expected value in production)

    // Get OAuth credentials from Secrets Manager
    const credentials = await getOAuthCredentials(config);

    // Get redirect URI from environment variable
    const redirectUri = getRedirectUri();

    // Exchange code for tokens
    let oauthResponse;
    try {
      oauthResponse = await exchangeCodeForTokens(
        code,
        credentials.clientId,
        credentials.clientSecret,
        redirectUri
      );
    } catch (error) {
      console.error("OAuth exchange error:", error);
      return createErrorResponse(
        401,
        `Unauthorized: Failed to exchange code for tokens - ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Create token item for DynamoDB
    const tokenItem = createOAuthTokenItem(oauthResponse);

    // Store tokens in DynamoDB
    try {
      await storeOAuthTokens(config.tableName, tokenItem);
    } catch (error) {
      console.error("DynamoDB write error:", error);
      return createErrorResponse(
        500,
        `Internal Server Error: Failed to store tokens - ${error instanceof Error ? error.message : String(error)}`
      );
    }

    console.log(
      `Successfully stored OAuth tokens for team: ${tokenItem.team_id}`
    );

    // Return success response
    return createSuccessResponse();
  } catch (error) {
    console.error("Unhandled error in OAuth callback:", error);
    return createErrorResponse(
      500,
      `Internal Server Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

