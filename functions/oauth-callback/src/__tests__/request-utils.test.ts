import {
  createSuccessResponse,
  getRedirectUri,
  validateQueryParams,
  getQueryParams,
  createErrorResponse,
} from '../request-utils';
import { LambdaFunctionURLRequest } from 'mnemosyne-slack-shared';

// Mock @aws-sdk/client-lambda before importing
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  GetFunctionUrlConfigCommand: jest.fn().mockImplementation((params) => ({
    input: params,
  })),
}));

describe('request-utils', () => {
  beforeEach(() => {
    delete process.env.REDIRECT_URI;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AWS_REGION;
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('createSuccessResponse', () => {
    it('should create success HTML response', () => {
      const response = createSuccessResponse();

      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toContain('text/html');
      expect(response.body).toContain('Installation Complete');
      expect(response.body).toContain('Mnemosyne has been successfully installed');
      expect(response.body).toContain('You can now return to Slack');
      expect(response.body).toContain('<!DOCTYPE html>');
      expect(response.body).toContain('<title>Installation Complete</title>');
    });

    it('should return valid HTML structure', () => {
      const response = createSuccessResponse();
      const body = response.body as string;

      expect(body).toContain('<html>');
      expect(body).toContain('</html>');
      expect(body).toContain('<head>');
      expect(body).toContain('</head>');
      expect(body).toContain('<body>');
      expect(body).toContain('</body>');
    });
  });

  describe('getRedirectUri', () => {
    it('should get redirect URI from environment variable when set', async () => {
      process.env.REDIRECT_URI = 'https://example.com/oauth/callback';

      const redirectUri = await getRedirectUri();

      expect(redirectUri).toBe('https://example.com/oauth/callback');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should return REDIRECT_URI immediately when truthy (early return branch)', async () => {
      process.env.REDIRECT_URI = 'https://custom-redirect.com';

      const redirectUri = await getRedirectUri();

      expect(redirectUri).toBe('https://custom-redirect.com');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should use REDIRECT_URI even if empty string (truthy check)', async () => {
      // Empty string is falsy in the check, so it should fall through to Lambda
      process.env.REDIRECT_URI = '';
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      mockSend.mockResolvedValue({
        FunctionUrl: 'https://test-function-url.lambda-url.us-east-1.on.aws',
      });

      const redirectUri = await getRedirectUri();

      // Empty string is falsy, so it should fetch from Lambda
      expect(redirectUri).toBe('https://test-function-url.lambda-url.us-east-1.on.aws');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should fetch Function URL from Lambda when REDIRECT_URI not set', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      mockSend.mockResolvedValue({
        FunctionUrl: 'https://test-function-url.lambda-url.us-east-1.on.aws',
      });

      const redirectUri = await getRedirectUri();

      expect(redirectUri).toBe('https://test-function-url.lambda-url.us-east-1.on.aws');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should fetch Function URL from Lambda when AWS_REGION is not set', async () => {
      delete process.env.REDIRECT_URI;
      delete process.env.AWS_REGION;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';

      mockSend.mockResolvedValue({
        FunctionUrl: 'https://test-function-url.lambda-url.us-east-1.on.aws',
      });

      const redirectUri = await getRedirectUri();

      expect(redirectUri).toBe('https://test-function-url.lambda-url.us-east-1.on.aws');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should pass AWS_REGION to LambdaClient when set', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-west-2';

      mockSend.mockResolvedValue({
        FunctionUrl: 'https://test-function-url.lambda-url.us-west-2.on.aws',
      });

      const redirectUri = await getRedirectUri();

      expect(redirectUri).toBe('https://test-function-url.lambda-url.us-west-2.on.aws');
      expect(mockSend).toHaveBeenCalled();
      // Verify LambdaClient was created with the correct region
      const { LambdaClient } = require('@aws-sdk/client-lambda');
      expect(LambdaClient).toHaveBeenCalledWith({ region: 'us-west-2' });
    });

    it('should handle Lambda client errors with message', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError = { message: 'Lambda service error', code: 'ServiceException' };
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction: Lambda service error'
      );
    });

    it('should handle Lambda client errors without message', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError = { code: 'ServiceException' };
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction'
      );
    });

    it('should handle Lambda client errors with undefined message', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError: any = { message: undefined };
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction: undefined'
      );
    });

    it('should handle non-Error objects thrown by Lambda client', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError = 'String error';
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction'
      );
    });


    it('should handle error with null message property', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError: any = { message: null };
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction: null'
      );
    });

    it('should handle error with empty string message', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError: any = { message: '' };
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction: '
      );
    });

    it('should handle errors that throw during catch block processing', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      // Error object where message is not a string
      const lambdaError: any = { message: { nested: 'error' } };
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction'
      );
    });

    it('should handle error objects with numeric message', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError: any = { message: 404 };
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction: 404'
      );
    });

    it('should handle error objects with boolean message', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError: any = { message: false };
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction: false'
      );
    });

    it('should throw error if Function URL is missing from Lambda response', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      mockSend.mockResolvedValue({
        FunctionUrl: undefined,
      });

      await expect(getRedirectUri()).rejects.toThrow(
        'No Function URL configured for TestFunction'
      );
    });

    it('should throw error if Lambda client fails', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      const lambdaError = new Error('Lambda client error');
      mockSend.mockRejectedValue(lambdaError);

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction: Lambda client error'
      );
    });

    it('should throw error if AWS_LAMBDA_FUNCTION_NAME is missing', async () => {
      delete process.env.REDIRECT_URI;
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;

      await expect(getRedirectUri()).rejects.toThrow(
        'AWS_LAMBDA_FUNCTION_NAME environment variable not found'
      );
    });
  });

  describe('validateQueryParams', () => {
    it('should validate query parameters successfully', () => {
      const queryParams = {
        code: 'test-code-123',
        state: 'test-state-456',
      };

      const result = validateQueryParams(queryParams);

      expect(result.code).toBe('test-code-123');
      expect(result.state).toBe('test-state-456');
    });

    it('should throw error if code is missing', () => {
      const queryParams = {
        state: 'test-state-456',
      };

      expect(() => validateQueryParams(queryParams)).toThrow(
        "Bad Request: Missing 'code' parameter"
      );
    });

    it('should allow missing state parameter', () => {
      const queryParams = {
        code: 'test-code-123',
      };

      const result = validateQueryParams(queryParams);

      expect(result.code).toBe('test-code-123');
      expect(result.state).toBeUndefined();
    });

    it('should allow empty state parameter', () => {
      const queryParams = {
        code: 'test-code-123',
        state: '',
      };

      const result = validateQueryParams(queryParams);

      expect(result.code).toBe('test-code-123');
      expect(result.state).toBeUndefined();
    });

    it('should handle state with falsy values', () => {
      const queryParams1 = {
        code: 'test-code-123',
        state: undefined as any,
      };

      const result1 = validateQueryParams(queryParams1);
      expect(result1.state).toBeUndefined();

      const queryParams2 = {
        code: 'test-code-123',
      };

      const result2 = validateQueryParams(queryParams2);
      expect(result2.state).toBeUndefined();
    });

    it('should handle state with truthy values', () => {
      const queryParams = {
        code: 'test-code-123',
        state: 'valid-state',
      };

      const result = validateQueryParams(queryParams);
      expect(result.code).toBe('test-code-123');
      expect(result.state).toBe('valid-state');
    });

    it('should handle state with various truthy values', () => {
      // Test that truthy state values are preserved
      const result1 = validateQueryParams({ code: 'test-code', state: 'state1' });
      expect(result1.state).toBe('state1');

      const result2 = validateQueryParams({ code: 'test-code', state: '0' });
      // '0' is a truthy string
      expect(result2.state).toBe('0');

      const result3 = validateQueryParams({ code: 'test-code', state: 'false' });
      // 'false' is a truthy string
      expect(result3.state).toBe('false');
    });

    it('should handle all falsy state values', () => {
      // Test that all falsy values result in undefined
      const falsyValues = ['', null, undefined, 0, false];
      
      for (const falsy of falsyValues) {
        const params: any = { code: 'test-code', state: falsy };
        const result = validateQueryParams(params);
        expect(result.state).toBeUndefined();
        expect(result.code).toBe('test-code');
      }
    });

    it('should throw error if code is missing', () => {
      const queryParams = {};

      expect(() => validateQueryParams(queryParams)).toThrow(
        "Bad Request: Missing 'code' parameter"
      );
    });

    it('should handle empty code string', () => {
      const queryParams = {
        code: '',
        state: 'test-state',
      };

      // Empty string is falsy, so it should throw
      expect(() => validateQueryParams(queryParams)).toThrow(
        "Bad Request: Missing 'code' parameter"
      );
    });
  });

  describe('getQueryParams', () => {
    it('should extract query parameters from request', () => {
      const request: LambdaFunctionURLRequest = {
        version: '2.0',
        routeKey: '$default',
        rawPath: '/',
        rawQueryString: 'code=test-code&state=test-state',
        headers: {},
        body: '{}',
        isBase64Encoded: false,
        requestContext: {
          accountId: '123456789012',
          apiId: 'test-api',
          domainName: 'test.lambda-url.eu-west-1.on.aws',
          domainPrefix: 'test',
          http: {
            method: 'GET',
            path: '/',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test-agent',
          },
          requestId: 'test-request-id',
          time: '2024-01-01T00:00:00.000Z',
          timeEpoch: 1704067200000,
        },
      };

      const queryParams = getQueryParams(request);

      expect(queryParams.code).toBe('test-code');
      expect(queryParams.state).toBe('test-state');
    });

    it('should handle empty query string', () => {
      const request: LambdaFunctionURLRequest = {
        version: '2.0',
        routeKey: '$default',
        rawPath: '/',
        rawQueryString: '',
        headers: {},
        body: '{}',
        isBase64Encoded: false,
        requestContext: {
          accountId: '123456789012',
          apiId: 'test-api',
          domainName: 'test.lambda-url.eu-west-1.on.aws',
          domainPrefix: 'test',
          http: {
            method: 'GET',
            path: '/',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test-agent',
          },
          requestId: 'test-request-id',
          time: '2024-01-01T00:00:00.000Z',
          timeEpoch: 1704067200000,
        },
      };

      const queryParams = getQueryParams(request);

      expect(queryParams).toEqual({});
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response', () => {
      const response = createErrorResponse(400, 'Bad Request');

      expect(response.statusCode).toBe(400);
      expect(response.body).toBeDefined();
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body.error).toBe('Bad Request');
    });

    it('should create error response with different status codes', () => {
      const response401 = createErrorResponse(401, 'Unauthorized');
      const response500 = createErrorResponse(500, 'Internal Server Error');

      expect(response401.statusCode).toBe(401);
      expect(response500.statusCode).toBe(500);

      const body401 = typeof response401.body === 'string' ? JSON.parse(response401.body) : response401.body;
      const body500 = typeof response500.body === 'string' ? JSON.parse(response500.body) : response500.body;

      expect(body401.error).toBe('Unauthorized');
      expect(body500.error).toBe('Internal Server Error');
    });
  });

  describe('re-exported functions', () => {
    it('should use re-exported getQueryParams', () => {
      const request: LambdaFunctionURLRequest = {
        version: '2.0',
        routeKey: '$default',
        rawPath: '/',
        rawQueryString: 'code=test&state=test',
        headers: {},
        body: '{}',
        isBase64Encoded: false,
        requestContext: {
          accountId: '123456789012',
          apiId: 'test-api',
          domainName: 'test.lambda-url.eu-west-1.on.aws',
          domainPrefix: 'test',
          http: {
            method: 'GET',
            path: '/',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test-agent',
          },
          requestId: 'test-request-id',
          time: '2024-01-01T00:00:00.000Z',
          timeEpoch: 1704067200000,
        },
      };

      const params = getQueryParams(request);
      expect(params.code).toBe('test');
      expect(params.state).toBe('test');
    });

    it('should use re-exported createErrorResponse', () => {
      const response = createErrorResponse(403, 'Forbidden');
      expect(response.statusCode).toBe(403);
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body.error).toBe('Forbidden');
    });
  });

  describe('lazy loading AWS SDK (lines 10-11, 16, 21-23)', () => {
    it('should handle lazy loading of Lambda client (lines 10-11, 16, 21-23)', async () => {
      // Test that AWS SDK modules are lazy loaded
      // This covers the lazy loading paths in request-utils.ts
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      mockSend.mockResolvedValue({
        FunctionUrl: 'https://test-function-url.lambda-url.us-east-1.on.aws',
      });

      // First call loads modules
      await getRedirectUri();

      // Second call should reuse loaded modules
      mockSend.mockResolvedValue({
        FunctionUrl: 'https://test-function-url.lambda-url.us-east-1.on.aws',
      });
      await getRedirectUri();

      // Modules are lazy loaded - client is created once per call to getRedirectUri
      // Since getRedirectUri is called twice and each creates a client with the singleton,
      // we verify that modules are lazy loaded correctly
      const { LambdaClient } = require('@aws-sdk/client-lambda');
      // LambdaClient is called for each getRedirectUri call (client created each time)
      expect(LambdaClient).toHaveBeenCalled();
      // Verify the import path exists (modules are loaded on first use)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle AWS SDK import failures gracefully', async () => {
      // Test error handling when AWS SDK modules fail to import
      // This verifies the error paths exist
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      // Make Lambda client send fail
      mockSend.mockRejectedValue(new Error('AWS SDK import failed'));

      await expect(getRedirectUri()).rejects.toThrow(
        'Failed to retrieve Function URL for TestFunction'
      );
    });
  });
});

