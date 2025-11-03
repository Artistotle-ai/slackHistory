import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
  getQueryParams as getQueryParamsShared,
  createErrorResponse as createErrorResponseShared,
  createSuccessHtmlResponse,
} from "mnemosyne-slack-shared";

// Re-export shared utilities
export { getQueryParamsShared as getQueryParams };
export { createErrorResponseShared as createErrorResponse };

/**
 * Create success HTML response for OAuth callback
 */
export function createSuccessResponse(): LambdaFunctionURLResponse {
  return createSuccessHtmlResponse(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Installation Complete</title>
</head>
<body>
  <h1>Installation Complete</h1>
  <p>Mnemosyne has been successfully installed to your Slack workspace.</p>
  <p>You can now return to Slack.</p>
</body>
</html>`);
}

/**
 * Get redirect URI from environment variable
 * This is set during Lambda function deployment via CDK
 */
export function getRedirectUri(): string {
  const envRedirectUri = process.env.REDIRECT_URI;
  if (!envRedirectUri) {
    throw new Error(
      "REDIRECT_URI environment variable is required. This should be set during Lambda deployment."
    );
  }
  return envRedirectUri;
}

/**
 * Validate OAuth callback query parameters
 *
 * Note: State parameter is optional. While recommended for CSRF protection,
 * Slack's built-in install flow may send empty state. Security is still maintained via:
 * - Single-use authorization codes
 * - redirect_uri validation by Slack
 * - HTTPS encryption
 */
export function validateQueryParams(queryParams: Record<string, string>): {
  code: string;
  state: string | undefined;
} {
  const code = queryParams.code;
  const state = queryParams.state;

  if (!code) {
    throw new Error("Bad Request: Missing 'code' parameter");
  }

  // State is optional - allow empty/missing values
  // In production with custom OAuth initiation, you should validate state against stored value
  return { code, state: state || undefined };
}

