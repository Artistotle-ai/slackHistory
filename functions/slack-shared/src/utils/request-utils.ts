import {
  LambdaFunctionURLRequest,
  LambdaFunctionURLResponse,
} from "../types";

/**
 * Parse and validate request body
 */
export function parseRequestBody(
  request: LambdaFunctionURLRequest
): unknown {
  let body = request.body || "{}";
  if (request.isBase64Encoded && body) {
    body = Buffer.from(body, "base64").toString("utf-8");
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error("Invalid JSON in request body");
  }
}

/**
 * Extract query parameters from Lambda Function URL request
 */
export function getQueryParams(
  request: LambdaFunctionURLRequest
): Record<string, string> {
  const queryParams: Record<string, string> = {};

  if (request.rawQueryString) {
    const params = new URLSearchParams(request.rawQueryString);
    params.forEach((value: string, key: string) => {
      queryParams[key] = value;
    });
  }

  return queryParams;
}

/**
 * Create error response
 */
export function createErrorResponse(
  statusCode: number,
  message: string
): LambdaFunctionURLResponse {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      error: message,
    }),
  };
}

/**
 * Create success JSON response
 */
export function createSuccessJsonResponse(
  body?: unknown
): LambdaFunctionURLResponse {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || { ok: true }),
  };
}

/**
 * Create success HTML response
 */
export function createSuccessHtmlResponse(
  html: string
): LambdaFunctionURLResponse {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
    body: html,
  };
}

