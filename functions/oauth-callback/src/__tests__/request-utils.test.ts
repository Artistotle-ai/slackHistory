import {
  createSuccessResponse,
  getRedirectUri,
  validateQueryParams,
  getQueryParams,
  createErrorResponse,
} from '../request-utils';
import { LambdaFunctionURLRequest } from 'mnemosyne-slack-shared';

describe('request-utils', () => {
  beforeEach(() => {
    delete process.env.REDIRECT_URI;
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
    it('should get redirect URI from environment variable', () => {
      process.env.REDIRECT_URI = 'https://example.com/oauth/callback';

      const redirectUri = getRedirectUri();

      expect(redirectUri).toBe('https://example.com/oauth/callback');
    });

    it('should throw error if REDIRECT_URI is missing', () => {
      expect(() => getRedirectUri()).toThrow(
        'REDIRECT_URI environment variable is required. This should be set during Lambda deployment.'
      );
    });

    it('should throw error if REDIRECT_URI is empty string', () => {
      process.env.REDIRECT_URI = '';

      expect(() => getRedirectUri()).toThrow(
        'REDIRECT_URI environment variable is required. This should be set during Lambda deployment.'
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

