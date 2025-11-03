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
 * Get redirect URI from environment variable or Lambda Function URL
 *
 * Priority:
 * 1. REDIRECT_URI environment variable (if set)
 * 2. Construct from AWS_LAMBDA_FUNCTION_NAME using AWS SDK
 *
 * Note: We don't set REDIRECT_URI in CDK to avoid circular dependencies.
 * Instead, Lambda retrieves its own Function URL at runtime.
 */
export async function getRedirectUri(): Promise<string> {
  // Check environment variable first (for testing/override)
  const envRedirectUri = process.env.REDIRECT_URI;
  if (envRedirectUri) {
    return envRedirectUri;
  }

  // Get Function URL using AWS SDK
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("AWS_LAMBDA_FUNCTION_NAME environment variable not found");
  }

  try {
    const { LambdaClient, GetFunctionUrlConfigCommand } = await import("@aws-sdk/client-lambda");
    const client = new LambdaClient({ region: process.env.AWS_REGION });

    const response = await client.send(
      new GetFunctionUrlConfigCommand({
        FunctionName: functionName,
      })
    );

    if (!response.FunctionUrl) {
      throw new Error(`No Function URL configured for ${functionName}`);
    }

    return response.FunctionUrl;
  } catch (error: any) {
    throw new Error(
      `Failed to retrieve Function URL for ${functionName}: ${error.message}`
    );
  }
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

