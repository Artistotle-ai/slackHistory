import {
  createSuccessResponse,
  getRedirectUri,
  validateQueryParams,
  getQueryParams,
  createErrorResponse,
} from '../request-utils';
import { LambdaFunctionURLRequest } from 'mnemosyne-slack-shared';

// Mock @aws-sdk/client-lambda before importing
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  GetFunctionUrlConfigCommand: jest.fn().mockImplementation((params) => params),
}));

describe('request-utils', () => {
  beforeEach(() => {
    delete process.env.REDIRECT_URI;
    jest.clearAllMocks();
  });

  describe('createSuccessResponse', () => {
    it('should create success HTML response', () => {
      const response = createSuccessResponse();

      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toContain('text/html');
      expect(response.body).toContain('Installation Complete');
      expect(response.body).toContain('Mnemosyne has been successfully installed');
    });
  });

  describe('getRedirectUri', () => {
    it('should get redirect URI from environment variable when set', async () => {
      process.env.REDIRECT_URI = 'https://example.com/oauth/callback';

      const redirectUri = await getRedirectUri();

      expect(redirectUri).toBe('https://example.com/oauth/callback');
    });

    it('should attempt to fetch from Lambda if REDIRECT_URI not set', async () => {
      delete process.env.REDIRECT_URI;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'TestFunction';
      process.env.AWS_REGION = 'us-east-1';

      // Mock will fail since we don't have actual Lambda client in tests
      await expect(getRedirectUri()).rejects.toThrow();
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
  });
});

