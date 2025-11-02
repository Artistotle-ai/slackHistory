import {
  parseRequestBody,
  getQueryParams,
  createErrorResponse,
  createSuccessJsonResponse,
  createSuccessHtmlResponse,
} from '../request-utils';
import { LambdaFunctionURLRequest } from '../../config/types';

describe('request-utils', () => {
  describe('parseRequestBody', () => {
    it('should parse JSON body', () => {
      const request: Partial<LambdaFunctionURLRequest> = {
        body: JSON.stringify({ key: 'value' }),
        isBase64Encoded: false,
      };

      const result = parseRequestBody(request as LambdaFunctionURLRequest);
      expect(result).toEqual({ key: 'value' });
    });

    it('should handle base64 encoded body', () => {
      const body = JSON.stringify({ key: 'value' });
      const base64Body = Buffer.from(body).toString('base64');
      
      const request: Partial<LambdaFunctionURLRequest> = {
        body: base64Body,
        isBase64Encoded: true,
      };

      const result = parseRequestBody(request as LambdaFunctionURLRequest);
      expect(result).toEqual({ key: 'value' });
    });

    it('should default to empty object if body is missing', () => {
      const request: Partial<LambdaFunctionURLRequest> = {
        isBase64Encoded: false,
      };

      const result = parseRequestBody(request as LambdaFunctionURLRequest);
      expect(result).toEqual({});
    });

    it('should throw error on invalid JSON', () => {
      const request: Partial<LambdaFunctionURLRequest> = {
        body: 'invalid json',
        isBase64Encoded: false,
      };

      expect(() => parseRequestBody(request as LambdaFunctionURLRequest)).toThrow(
        'Invalid JSON in request body'
      );
    });
  });

  describe('getQueryParams', () => {
    it('should parse query parameters', () => {
      const request: Partial<LambdaFunctionURLRequest> = {
        rawQueryString: 'key1=value1&key2=value2',
      };

      const result = getQueryParams(request as LambdaFunctionURLRequest);
      expect(result).toEqual({
        key1: 'value1',
        key2: 'value2',
      });
    });

    it('should return empty object if no query string', () => {
      const request: Partial<LambdaFunctionURLRequest> = {
        rawQueryString: '',
      };

      const result = getQueryParams(request as LambdaFunctionURLRequest);
      expect(result).toEqual({});
    });

    it('should handle single query parameter', () => {
      const request: Partial<LambdaFunctionURLRequest> = {
        rawQueryString: 'key=value',
      };

      const result = getQueryParams(request as LambdaFunctionURLRequest);
      expect(result).toEqual({ key: 'value' });
    });

    it('should handle URL-encoded values', () => {
      const request: Partial<LambdaFunctionURLRequest> = {
        rawQueryString: 'key=hello%20world',
      };

      const result = getQueryParams(request as LambdaFunctionURLRequest);
      expect(result).toEqual({ key: 'hello world' });
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response with status code and message', () => {
      const response = createErrorResponse(400, 'Bad Request');
      
      expect(response.statusCode).toBe(400);
      expect(response.headers?.['Content-Type']).toBe('application/json');
      expect(JSON.parse(response.body || '{}')).toEqual({ error: 'Bad Request' });
    });

    it('should handle different status codes', () => {
      const response = createErrorResponse(500, 'Internal Server Error');
      
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body || '{}')).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('createSuccessJsonResponse', () => {
    it('should create success response with default body', () => {
      const response = createSuccessJsonResponse();
      
      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('application/json');
      expect(JSON.parse(response.body || '{}')).toEqual({ ok: true });
    });

    it('should create success response with custom body', () => {
      const customBody = { message: 'Success', data: { id: 123 } };
      const response = createSuccessJsonResponse(customBody);
      
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body || '{}')).toEqual(customBody);
    });

    it('should handle null body', () => {
      const response = createSuccessJsonResponse(null);
      
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body || '{}')).toEqual({ ok: true });
    });
  });

  describe('createSuccessHtmlResponse', () => {
    it('should create HTML response', () => {
      const html = '<html><body>Hello</body></html>';
      const response = createSuccessHtmlResponse(html);
      
      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('text/html; charset=utf-8');
      expect(response.body).toBe(html);
    });

    it('should handle complex HTML', () => {
      const html = '<html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>';
      const response = createSuccessHtmlResponse(html);
      
      expect(response.body).toBe(html);
      expect(response.headers?.['Content-Type']).toBe('text/html; charset=utf-8');
    });
  });
});

