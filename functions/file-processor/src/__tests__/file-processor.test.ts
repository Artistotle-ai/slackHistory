import { processFile, processMessageFiles } from '../file-processor';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  getValidBotToken: jest.fn(),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock AWS S3 client
const mockS3Client = {
  send: jest.fn(),
};

// Mock HTTP/HTTPS modules
const mockHttpRequest = jest.fn();
const mockHttpsRequest = jest.fn();

jest.mock('http', () => ({
  request: (...args: any[]) => mockHttpRequest(...args),
}));

jest.mock('https', () => ({
  request: (...args: any[]) => mockHttpsRequest(...args),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3Client),
  PutObjectCommand: jest.fn((params: any) => ({ params })),
}));

describe('file-processor', () => {
  const mockGetValidBotToken = shared.getValidBotToken as jest.Mock;
  const mockS3Send = mockS3Client.send as jest.Mock;

  interface MockRequest {
    on: jest.Mock;
    end: jest.Mock;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetValidBotToken.mockResolvedValue('bot-token-123');
    mockS3Send.mockResolvedValue({});
  });

  describe('processFile', () => {
    it('should throw error if file has no url_private', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
      };

      await expect(
        processFile(
          file,
          'T123',
          'C456',
          '1234567890.123456',
          'bot-token',
          'test-bucket',
          mockS3Client
        )
      ).rejects.toThrow('File file1 has no url_private - external file, skipping');
    });

    it('should process file successfully', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      // Mock HTTPS request/response
      interface MockRequest {
        on: jest.Mock;
        end: jest.Mock;
      }

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setImmediate(() => handler());
          }
        }),
      };

      const mockRequest: MockRequest = {
        on: jest.fn((_event: string, _handler: Function) => {
          // Handle error events for network errors
          return mockRequest;
        }),
        end: jest.fn(),
      };

      // Mock the request function to call the callback with the response
      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setImmediate(() => callback(mockResponse));
        return mockRequest;
      });

      const s3Key = await processFile(
        file,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      expect(s3Key).toBe('slack/T123/C456/1234567890.123456/file1');
      expect(mockHttpsRequest).toHaveBeenCalled();
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('should retry on failure with exponential backoff', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      let attemptCount = 0;
      interface MockRequest {
        on: jest.Mock;
        end: jest.Mock;
      }

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setImmediate(() => handler());
          }
        }),
      };

      const mockRequest: MockRequest = {
        on: jest.fn((_event: string, _handler: Function) => {
          // Handle error events for network errors
          return mockRequest;
        }),
        end: jest.fn(),
      };

      // Mock the request function - S3 will fail twice, then succeed
      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setImmediate(() => callback(mockResponse));
        return mockRequest;
      });

      mockS3Send
        .mockRejectedValueOnce(new Error('S3 error 1'))
        .mockRejectedValueOnce(new Error('S3 error 2'))
        .mockResolvedValueOnce({});

      // Note: Retry logic uses delays, so we need to wait for them
      // The retry logic will retry on S3 errors
      const s3Key = await processFile(
        file,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      expect(s3Key).toBe('slack/T123/C456/1234567890.123456/file1');
      // S3 is called multiple times due to retries
      expect(mockS3Send.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should throw error if all retries fail', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setImmediate(() => handler());
          }
        }),
      };

      const mockRequest: MockRequest = {
        on: jest.fn((_event: string, _handler: Function) => {
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setImmediate(() => callback(mockResponse));
        return mockRequest;
      });

      mockS3Send.mockRejectedValue(new Error('S3 error'));

      await expect(
        processFile(
          file,
          'T123',
          'C456',
          '1234567890.123456',
          'bot-token',
          'test-bucket',
          mockS3Client
        )
      ).rejects.toThrow();
    });

    it('should handle HTTP 200 response', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'http://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setImmediate(() => handler());
          }
        }),
      };

      const mockRequest: MockRequest = {
        on: jest.fn((_event: string, _handler: Function) => {
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpRequest.mockImplementation((_options: any, callback: Function) => {
        setImmediate(() => callback(mockResponse));
        return mockRequest;
      });

      await processFile(
        file,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      expect(mockHttpRequest).toHaveBeenCalled();
    });

    it('should handle non-200 HTTP status codes', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockResponse = {
        statusCode: 404,
        headers: {},
      };

      const mockRequest: MockRequest = {
        on: jest.fn((_event: string, _handler: Function) => {
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setImmediate(() => callback(mockResponse));
        return mockRequest;
      });

      const promise = processFile(
        file,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      await expect(promise).rejects.toThrow('Failed to download file: HTTP 404');
    });
  });

  describe('processMessageFiles', () => {
    it('should process all files successfully', async () => {
      const item = {
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [
          {
            id: 'file1',
            name: 'test1.txt',
            url_private: 'https://files.slack.com/files-pri/file1',
            mimetype: 'text/plain',
          },
          {
            id: 'file2',
            name: 'test2.txt',
            url_private: 'https://files.slack.com/files-pri/file2',
            mimetype: 'text/plain',
          },
        ],
      };

      const oauthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      };

      // Mock successful HTTPS requests
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setImmediate(() => handler());
          }
        }),
      };

      const mockRequest: MockRequest = {
        on: jest.fn((_event: string, _handler: Function) => {
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setImmediate(() => callback(mockResponse));
        return mockRequest;
      });

      const result = await processMessageFiles(
        item,
        oauthConfig,
        'test-bucket',
        mockS3Client,
        'client-id',
        'client-secret'
      );

      expect(result.s3Keys).toHaveLength(2);
      expect(result.s3Keys[0]).toBe('slack/T123/C456/1234567890.123456/file1');
      expect(result.s3Keys[1]).toBe('slack/T123/C456/1234567890.123456/file2');
      expect(result.failedFiles).toHaveLength(0);
      expect(mockGetValidBotToken).toHaveBeenCalledWith(
        'test-table',
        'T123',
        'client-id',
        'client-secret'
      );
    });

    it('should handle partial failures', async () => {
      const item = {
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [
          {
            id: 'file1',
            name: 'test1.txt',
            url_private: 'https://files.slack.com/files-pri/file1',
            mimetype: 'text/plain',
          },
          {
            id: 'file2',
            name: 'test2.txt',
            // Missing url_private
          },
        ],
      };

      const oauthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      };

      // Mock successful HTTPS request for file1
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'end') {
            setImmediate(() => handler());
          }
        }),
      };

      const mockRequest: MockRequest = {
        on: jest.fn((_event: string, _handler: Function) => {
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setImmediate(() => callback(mockResponse));
        return mockRequest;
      });

      const result = await processMessageFiles(
        item,
        oauthConfig,
        'test-bucket',
        mockS3Client,
        'client-id',
        'client-secret'
      );

      expect(result.s3Keys).toHaveLength(1);
      expect(result.failedFiles).toHaveLength(1);
      expect(result.failedFiles[0].file.id).toBe('file2');
    });

    it('should handle all files failing', async () => {
      const item = {
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [
          {
            id: 'file1',
            name: 'test1.txt',
            // Missing url_private
          },
          {
            id: 'file2',
            name: 'test2.txt',
            // Missing url_private
          },
        ],
      };

      const oauthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      };

      const result = await processMessageFiles(
        item,
        oauthConfig,
        'test-bucket',
        mockS3Client,
        'client-id',
        'client-secret'
      );

      expect(result.s3Keys).toHaveLength(0);
      expect(result.failedFiles).toHaveLength(2);
    });

    it('should handle empty files array', async () => {
      const item = {
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [],
      };

      const oauthConfig = {
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      };

      const result = await processMessageFiles(
        item,
        oauthConfig,
        'test-bucket',
        mockS3Client,
        'client-id',
        'client-secret'
      );

      expect(result.s3Keys).toHaveLength(0);
      expect(result.failedFiles).toHaveLength(0);
    });
  });
});

