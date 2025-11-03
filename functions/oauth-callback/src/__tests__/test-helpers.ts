import { LambdaFunctionURLRequest } from 'mnemosyne-slack-shared';

/**
 * Create a minimal LambdaFunctionURLRequest for testing
 */
export function createTestRequest(overrides: Partial<LambdaFunctionURLRequest> = {}): LambdaFunctionURLRequest {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers: {},
    body: '{}',
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api-id',
      domainName: 'test.lambda-url.eu-west-1.on.aws',
      domainPrefix: 'test',
      http: {
        method: 'POST',
        path: '/',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
      },
      requestId: 'test-request-id',
      time: '2024-01-01T00:00:00.000Z',
      timeEpoch: 1704067200000,
    },
    ...overrides,
  };
}

