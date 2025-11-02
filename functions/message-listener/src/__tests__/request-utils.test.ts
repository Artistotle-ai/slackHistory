import {
  handleUrlVerification,
  parseRequestBody,
  extractSignatureHeaders,
  createErrorResponse,
  createSuccessResponse,
} from '../request-utils';
import { LambdaFunctionURLRequest, LambdaFunctionURLResponse } from 'mnemosyne-slack-shared';
import { createTestRequest } from './test-helpers';

describe('request-utils', () => {
  describe('handleUrlVerification', () => {
    it('should return challenge in response', () => {
      const event = {
        type: 'url_verification' as const,
        challenge: 'test_challenge_token',
      };

      const response = handleUrlVerification(event);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBeDefined();
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body).toEqual({ challenge: 'test_challenge_token' });
    });
  });

  describe('parseRequestBody', () => {
    it('should parse JSON body', () => {
      const request = createTestRequest({
        body: JSON.stringify({ type: 'event_callback', event: { type: 'message' } }),
      });

      const event = parseRequestBody(request);
      expect(event).toEqual({ type: 'event_callback', event: { type: 'message' } });
    });

    it('should handle base64 encoded body', () => {
      const body = JSON.stringify({ type: 'event_callback', event: { type: 'message' } });
      const base64Body = Buffer.from(body).toString('base64');

      const request = createTestRequest({
        body: base64Body,
        isBase64Encoded: true,
      });

      const event = parseRequestBody(request);
      expect(event).toEqual({ type: 'event_callback', event: { type: 'message' } });
    });

    it('should throw on invalid JSON', () => {
      const request = createTestRequest({
        body: 'invalid json',
      });

      expect(() => parseRequestBody(request)).toThrow();
    });
  });

  describe('extractSignatureHeaders', () => {
    it('should extract lowercase headers', () => {
      const request = createTestRequest({
        headers: {
          'x-slack-signature': 'v0=test_signature',
          'x-slack-request-timestamp': '1234567890',
        },
      });

      const headers = extractSignatureHeaders(request);
      expect(headers.signature).toBe('v0=test_signature');
      expect(headers.timestamp).toBe('1234567890');
    });

    it('should extract uppercase headers', () => {
      const request = createTestRequest({
        headers: {
          'X-Slack-Signature': 'v0=test_signature',
          'X-Slack-Request-Timestamp': '1234567890',
        },
      });

      const headers = extractSignatureHeaders(request);
      expect(headers.signature).toBe('v0=test_signature');
      expect(headers.timestamp).toBe('1234567890');
    });

    it('should throw on missing signature header', () => {
      const request = createTestRequest({
        headers: {
          'x-slack-request-timestamp': '1234567890',
        },
      });

      expect(() => extractSignatureHeaders(request)).toThrow('Missing Slack signature headers');
    });

    it('should throw on missing timestamp header', () => {
      const request = createTestRequest({
        headers: {
          'x-slack-signature': 'v0=test_signature',
        },
      });

      expect(() => extractSignatureHeaders(request)).toThrow('Missing Slack signature headers');
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response with status code and message', () => {
      const response = createErrorResponse(400, 'Bad Request');
      expect(response.statusCode).toBe(400);
      expect(response.headers?.['Content-Type']).toBe('application/json');
      expect(response.body).toBeDefined();
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body).toEqual({ error: 'Bad Request' });
    });
  });

  describe('createSuccessResponse', () => {
    it('should create success response', () => {
      const response = createSuccessResponse();
      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('application/json');
      expect(response.body).toBeDefined();
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      // Success response may be empty object or include "ok": true
      expect(body).toHaveProperty('ok', true);
    });
  });
});

