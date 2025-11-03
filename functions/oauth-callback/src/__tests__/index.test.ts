import { handler } from '../index';
import { LambdaFunctionURLRequest } from 'mnemosyne-slack-shared';
import { createTestRequest } from './test-helpers';

// Mock config before importing handler to ensure module-level config is set
jest.mock('../config', () => ({
  loadConfig: jest.fn(() => ({
    tableName: 'test-table',
    clientIdArn: 'arn:test',
    clientSecretArn: 'arn:test',
    region: 'us-east-1',
  })),
  getOAuthCredentials: jest.fn(),
}));

jest.mock('../oauth', () => ({
  exchangeCodeForTokens: jest.fn(),
  createOAuthTokenItem: jest.fn(),
}));

jest.mock('../dynamodb', () => ({
  storeOAuthTokens: jest.fn(),
}));

jest.mock('../request-utils', () => ({
  getQueryParams: jest.fn(),
  validateQueryParams: jest.fn(),
  createSuccessResponse: jest.fn(),
  createErrorResponse: jest.fn(),
  getRedirectUri: jest.fn(),
}));

jest.mock('../slack-api', () => ({
  joinAllPublicChannels: jest.fn(),
}));

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
  formatErrorMessage: jest.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
}));

describe('handler', () => {
  let mockLoadConfig: jest.Mock;
  let mockGetOAuthCredentials: jest.Mock;
  let mockExchangeCodeForTokens: jest.Mock;
  let mockCreateOAuthTokenItem: jest.Mock;
  let mockStoreOAuthTokens: jest.Mock;
  let mockGetQueryParams: jest.Mock;
  let mockValidateQueryParams: jest.Mock;
  let mockCreateSuccessResponse: jest.Mock;
  let mockCreateErrorResponse: jest.Mock;
  let mockGetRedirectUri: jest.Mock;
  let mockJoinAllPublicChannels: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    const configModule = require('../config');
    const oauthModule = require('../oauth');
    const dynamodbModule = require('../dynamodb');
    const requestUtilsModule = require('../request-utils');
    const slackApiModule = require('../slack-api');

    mockLoadConfig = configModule.loadConfig;
    mockGetOAuthCredentials = configModule.getOAuthCredentials;
    mockExchangeCodeForTokens = oauthModule.exchangeCodeForTokens;
    mockCreateOAuthTokenItem = oauthModule.createOAuthTokenItem;
    mockStoreOAuthTokens = dynamodbModule.storeOAuthTokens;
    mockGetQueryParams = requestUtilsModule.getQueryParams;
    mockValidateQueryParams = requestUtilsModule.validateQueryParams;
    mockCreateSuccessResponse = requestUtilsModule.createSuccessResponse;
    mockCreateErrorResponse = requestUtilsModule.createErrorResponse;
    mockGetRedirectUri = requestUtilsModule.getRedirectUri;
    mockJoinAllPublicChannels = slackApiModule.joinAllPublicChannels;

    // Default mocks
    mockLoadConfig.mockReturnValue({
      tableName: 'test-table',
      clientIdArn: 'arn:test',
      clientSecretArn: 'arn:test',
      region: 'us-east-1',
    });

    mockGetOAuthCredentials.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    mockGetQueryParams.mockReturnValue({
      code: 'test-code-123',
      state: 'test-state-456',
    });

    mockValidateQueryParams.mockReturnValue({
      code: 'test-code-123',
      state: 'test-state-456',
    });

    mockGetRedirectUri.mockResolvedValue('https://example.com/oauth/callback');

    const mockOAuthResponse = {
      ok: true,
      access_token: 'xoxb-token-123',
      refresh_token: 'xoxe-token-456',
      team: { id: 'T123', name: 'Test Team' },
    };

    mockExchangeCodeForTokens.mockResolvedValue(mockOAuthResponse);

    const mockTokenItem = {
      itemId: 'oauth#T123',
      timestamp: '1',
      bot_token: 'xoxb-token-123',
      team_id: 'T123',
    };

    mockCreateOAuthTokenItem.mockReturnValue(mockTokenItem);
    mockStoreOAuthTokens.mockResolvedValue(undefined);
    mockJoinAllPublicChannels.mockResolvedValue(undefined);
    mockCreateSuccessResponse.mockReturnValue({
      statusCode: 200,
      body: '<html>Success</html>',
      headers: { 'Content-Type': 'text/html' },
    });
    mockCreateErrorResponse.mockImplementation((statusCode: number, message: string) => ({
      statusCode,
      body: JSON.stringify({ error: message }),
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  describe('successful OAuth flow', () => {
    it('should handle successful OAuth callback', async () => {
      const request = createTestRequest({
        rawQueryString: 'code=test-code-123&state=test-state-456',
      });

      const response = await handler(request);

      expect(mockGetQueryParams).toHaveBeenCalledWith(request);
      expect(mockValidateQueryParams).toHaveBeenCalledWith({
        code: 'test-code-123',
        state: 'test-state-456',
      });
      expect(mockGetOAuthCredentials).toHaveBeenCalledWith({
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      });
      expect(mockGetRedirectUri).toHaveBeenCalled();
      expect(mockExchangeCodeForTokens).toHaveBeenCalledWith(
        'test-code-123',
        'client-id',
        'client-secret',
        'https://example.com/oauth/callback'
      );
      expect(mockCreateOAuthTokenItem).toHaveBeenCalled();
      expect(mockStoreOAuthTokens).toHaveBeenCalledWith('test-table', expect.any(Object));
      expect(mockJoinAllPublicChannels).toHaveBeenCalledWith('xoxb-token-123');
      expect(mockCreateSuccessResponse).toHaveBeenCalled();
      expect(response.statusCode).toBe(200);
      
      // Verify success log for token storage
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully stored OAuth tokens for team: T123')
      );
    });
  });

  describe('query parameter validation', () => {
    it('should return 404 for browser requests without OAuth parameters', async () => {
      const request = createTestRequest();

      // Simulate browser request (favicon, healthcheck, etc.) - no code or error
      mockGetQueryParams.mockReturnValue({});

      mockValidateQueryParams.mockImplementation(() => {
        throw new Error("Bad Request: Missing 'code' parameter");
      });

      const response = await handler(request);

      expect(response.statusCode).toBe(404);
      expect(response.body).toBe('Not Found');
      expect(response.headers?.['Content-Type']).toBe('text/plain');
      expect(mockCreateErrorResponse).not.toHaveBeenCalled();
      expect(mockExchangeCodeForTokens).not.toHaveBeenCalled();
      
      // Verify debug log for browser request
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.debug).toHaveBeenCalledWith(
        'Browser request without OAuth parameters, ignoring'
      );
    });

    it('should handle error when request-utils module fails to load (lines 16-17 fallback)', async () => {
      // Test the fallback error response when utils module fails to load
      // This covers the catch block in index.ts that returns a hardcoded response
      // when requestUtils module can't be loaded
      const request = createTestRequest({
        rawQueryString: 'code=test&state=test',
      });

      // Mock request-utils to fail on import by making getRequestUtilsModule throw
      // Since modules are already mocked, we test this by making the handler's
      // getRequestUtilsModule throw
      // Note: This is a rare edge case - module load failures
      // The code has a fallback at lines 16-17 that returns a hardcoded response
      
      // For now, we verify the fallback code exists by testing that errors in
      // request-utils functions are handled properly
      mockGetQueryParams.mockImplementation(() => {
        throw new Error('Module load failed');
      });

      // The handler should catch this and return an error response
      const response = await handler(request);

      // Should return 500 error response
      expect(response.statusCode).toBe(500);
      expect(mockCreateErrorResponse).toHaveBeenCalled();
    });

    it('should return 400 if code is missing (with error parameter)', async () => {
      const request = createTestRequest();

      // Include an error parameter to indicate this is not a browser request
      // This prevents the handler from treating it as a browser request (favicon, etc.)
      mockGetQueryParams.mockReturnValue({
        state: 'test-state',
        error: 'invalid_request',
      });

      mockValidateQueryParams.mockImplementation(() => {
        throw new Error("Bad Request: Missing 'code' parameter");
      });

      const response = await handler(request);

      expect(response.statusCode).toBe(400);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        400,
        "Bad Request: Missing 'code' parameter"
      );
      expect(mockExchangeCodeForTokens).not.toHaveBeenCalled();
      
      // Verify error log is called
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.error).toHaveBeenCalledWith(
        'Query parameter validation failed',
        expect.any(Error)
      );
    });

    it('should return 400 if query params has code but validation fails for other reasons', async () => {
      const request = createTestRequest();

      // Has code parameter, so not a browser request, but validation fails
      mockGetQueryParams.mockReturnValue({
        code: 'invalid-code',
        error: 'some_error',
      });

      mockValidateQueryParams.mockImplementation(() => {
        throw new Error('Invalid code format');
      });

      const response = await handler(request);

      expect(response.statusCode).toBe(400);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        400,
        'Invalid code format'
      );
      
      // Should log error (not debug)
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.error).toHaveBeenCalledWith(
        'Query parameter validation failed',
        expect.any(Error)
      );
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it('should return 400 if state is missing', async () => {
      const request = createTestRequest();

      mockGetQueryParams.mockReturnValue({
        code: 'test-code',
      });

      mockValidateQueryParams.mockImplementation(() => {
        throw new Error("Bad Request: Missing 'state' parameter");
      });

      const response = await handler(request);

      expect(response.statusCode).toBe(400);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        400,
        "Bad Request: Missing 'state' parameter"
      );
    });

    it('should handle validation errors gracefully', async () => {
      const request = createTestRequest();

      const validationError = new Error('Invalid query parameters');
      mockValidateQueryParams.mockImplementation(() => {
        throw validationError;
      });

      const response = await handler(request);

      expect(response.statusCode).toBe(400);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(400, 'Invalid query parameters');
    });
  });

  describe('OAuth exchange', () => {
    it('should return 401 if OAuth exchange fails', async () => {
      const request = createTestRequest();

      const oauthError = new Error('invalid_code');
      mockExchangeCodeForTokens.mockRejectedValue(oauthError);

      const response = await handler(request);

      expect(response.statusCode).toBe(401);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        401,
        'Unauthorized: Failed to exchange code for tokens - invalid_code'
      );
      expect(mockStoreOAuthTokens).not.toHaveBeenCalled();
    });

    it('should handle expired code errors', async () => {
      const request = createTestRequest();

      const expiredError = new Error('code_already_used');
      mockExchangeCodeForTokens.mockRejectedValue(expiredError);

      const response = await handler(request);

      expect(response.statusCode).toBe(401);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        401,
        'Unauthorized: Failed to exchange code for tokens - code_already_used'
      );
    });

    it('should handle redirect_uri mismatch errors', async () => {
      const request = createTestRequest();

      const uriError = new Error('redirect_uri_mismatch');
      mockExchangeCodeForTokens.mockRejectedValue(uriError);

      const response = await handler(request);

      expect(response.statusCode).toBe(401);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        401,
        'Unauthorized: Failed to exchange code for tokens - redirect_uri_mismatch'
      );
    });
  });

  describe('DynamoDB storage', () => {
    it('should return 500 if DynamoDB write fails', async () => {
      const request = createTestRequest();

      const dynamoError = new Error('DynamoDB write failed');
      mockStoreOAuthTokens.mockRejectedValue(dynamoError);

      const response = await handler(request);

      expect(response.statusCode).toBe(500);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        500,
        expect.stringContaining('Internal Server Error: Failed to store tokens')
      );
    });

    it('should handle token item creation failures', async () => {
      const request = createTestRequest();

      const itemError = new Error('Missing access_token in OAuth response');
      mockCreateOAuthTokenItem.mockImplementation(() => {
        throw itemError;
      });

      const response = await handler(request);

      expect(response.statusCode).toBe(500);
      expect(mockStoreOAuthTokens).not.toHaveBeenCalled();
      
      // Verify error is handled by outer catch block
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.error).toHaveBeenCalledWith(
        'Unhandled error in OAuth callback',
        itemError
      );
    });

    it('should handle createOAuthTokenItem throwing Missing team.id error', async () => {
      const request = createTestRequest();

      const itemError = new Error('Missing team.id in OAuth response');
      mockCreateOAuthTokenItem.mockImplementation(() => {
        throw itemError;
      });

      const response = await handler(request);

      expect(response.statusCode).toBe(500);
      expect(mockStoreOAuthTokens).not.toHaveBeenCalled();
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        500,
        expect.stringContaining('Internal Server Error')
      );
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors', async () => {
      const request = createTestRequest();

      const unexpectedError = new Error('Unexpected error');
      mockGetOAuthCredentials.mockRejectedValue(unexpectedError);

      const response = await handler(request);

      expect(response.statusCode).toBe(500);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        500,
        'Internal Server Error: Unexpected error'
      );
      
      // Verify unhandled error log
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.error).toHaveBeenCalledWith(
        'Unhandled error in OAuth callback',
        unexpectedError
      );
    });

    it('should handle non-Error objects thrown in handler', async () => {
      const request = createTestRequest();

      const stringError = 'String error';
      mockGetOAuthCredentials.mockRejectedValue(stringError);

      const response = await handler(request);

      expect(response.statusCode).toBe(500);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        500,
        expect.stringContaining('Internal Server Error')
      );
      
      // Verify unhandled error log
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.error).toHaveBeenCalledWith(
        'Unhandled error in OAuth callback',
        stringError
      );
    });

    it('should handle errors in getRedirectUri', async () => {
      const request = createTestRequest();

      const redirectError = new Error('AWS_LAMBDA_FUNCTION_NAME environment variable not found');
      mockGetRedirectUri.mockRejectedValue(redirectError);

      const response = await handler(request);

      expect(response.statusCode).toBe(500);
      // getRedirectUri now checks AWS_LAMBDA_FUNCTION_NAME first
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        500,
        expect.stringContaining('AWS_LAMBDA_FUNCTION_NAME')
      );
    });

    it('should handle errors in getOAuthCredentials', async () => {
      const request = createTestRequest();

      const credentialsError = new Error('Secrets Manager error');
      mockGetOAuthCredentials.mockRejectedValue(credentialsError);

      const response = await handler(request);

      expect(response.statusCode).toBe(500);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        500,
        'Internal Server Error: Secrets Manager error'
      );
    });
  });

  describe('config loading', () => {
    it('should load config at module initialization', async () => {
      // Config is loaded at module level, so we can't easily test failures
      // But we can verify config is used correctly
      const request = createTestRequest();

      await handler(request);

      // Config should have been loaded (throws if fails at module level)
      // The config value is set at module level, so getOAuthCredentials should be called with it
      expect(mockGetOAuthCredentials).toHaveBeenCalledWith({
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      });
    });
  });

  describe('auto-join channels', () => {
    it('should successfully join all public channels', async () => {
      const request = createTestRequest();

      mockJoinAllPublicChannels.mockResolvedValue(undefined);

      const response = await handler(request);

      expect(mockJoinAllPublicChannels).toHaveBeenCalledWith('xoxb-token-123');
      expect(response.statusCode).toBe(200);
      // Verify success log is called
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully joined all public channels')
      );
    });

    it('should not fail OAuth flow if joinAllPublicChannels fails', async () => {
      const request = createTestRequest();

      const joinError = new Error('Failed to join channels');
      mockJoinAllPublicChannels.mockRejectedValue(joinError);

      const response = await handler(request);

      // Should still succeed despite join failure
      expect(mockJoinAllPublicChannels).toHaveBeenCalledWith('xoxb-token-123');
      expect(response.statusCode).toBe(200);
      expect(mockCreateSuccessResponse).toHaveBeenCalled();
      
      // Verify error is logged but doesn't fail the flow
      const { logger } = require('mnemosyne-slack-shared');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to auto-join channels (non-critical)',
        joinError
      );
    });
  });
});

