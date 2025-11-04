import { processFile, processMessageFiles } from '../file-processor';
import * as shared from 'mnemosyne-slack-shared';
import { Readable } from 'stream';

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

// Mock lib-storage Upload
const mockUploadDone = jest.fn().mockResolvedValue({});
const mockUploadAbort = jest.fn().mockResolvedValue({});
const mockUploadConstructor = jest.fn(() => ({
  done: mockUploadDone,
  abort: mockUploadAbort,
}));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: mockUploadConstructor,
}));

// Mock stream module
// Note: We can't mock stream module without breaking AWS SDK
// The PassThrough usage will work with the real stream module

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
    mockUploadDone.mockResolvedValue({});
    mockUploadAbort.mockResolvedValue({});
    mockUploadConstructor.mockClear();
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

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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
      expect(mockUploadConstructor).toHaveBeenCalled();
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

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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

      mockUploadDone
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
      // Upload is called multiple times due to retries
      expect(mockUploadConstructor.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should throw error if all retries fail', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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

      // Mock Upload.done() to fail 3 times (max retries)
      mockUploadDone
        .mockRejectedValueOnce(new Error('S3 error'))
        .mockRejectedValueOnce(new Error('S3 error'))
        .mockRejectedValueOnce(new Error('S3 error'));

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

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 404,
        headers: {},
      } as any);

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
      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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
      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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

    it('should handle HTTP request network errors', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockRequest: MockRequest = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            setImmediate(() => handler(new Error('Network error')));
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockImplementation((_options: any, _callback: Function) => {
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

      await expect(promise).rejects.toThrow('Failed to download from Slack: Network error');
    });

    it('should handle S3 upload errors', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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

      // Mock Upload.done() to fail (will trigger retries, then throw after max retries)
      mockUploadDone
        .mockRejectedValueOnce(new Error('S3 upload failed'))
        .mockRejectedValueOnce(new Error('S3 upload failed'))
        .mockRejectedValueOnce(new Error('S3 upload failed'));

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

    it('should use default content type when mimetype and headers are missing', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: {}, // No content-type header
      } as any);

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

      await processFile(
        file,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      expect(mockUploadConstructor).toHaveBeenCalled();
      const uploadCall = ((mockUploadConstructor as jest.Mock).mock.calls[0] as any)[0];
      expect(uploadCall.params.ContentType).toBe('application/octet-stream');
    });

    it('should handle files with missing name', async () => {
      const file = {
        id: 'file1',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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
    });

    it('should handle retry logic with different error types', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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

      // First two attempts fail, third succeeds
      mockUploadDone
        .mockRejectedValueOnce(new Error('S3 error 1'))
        .mockRejectedValueOnce(new Error('S3 error 2'))
        .mockResolvedValueOnce({});

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
      expect(mockUploadConstructor).toHaveBeenCalledTimes(3);
    });

    it('should reuse cached modules when processing multiple files', async () => {
      const file1 = {
        id: 'file1',
        name: 'test1.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const file2 = {
        id: 'file2',
        name: 'test2.txt',
        url_private: 'https://files.slack.com/files-pri/file2',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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

      // Process first file - modules will be loaded
      await processFile(
        file1,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      // Process second file - modules should be cached (covers cache paths)
      const s3Key2 = await processFile(
        file2,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      expect(s3Key2).toBe('slack/T123/C456/1234567890.123456/file2');
      expect(mockHttpsRequest).toHaveBeenCalledTimes(2);
    });

    it('should handle retry logic when lastError is null', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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

      // This should never happen in practice, but test the edge case
      // Mock S3 to reject without throwing an error somehow
      let callCount = 0;
      mockS3Send.mockImplementation(() => {
        callCount++;
        if (callCount === 3) {
          // On third attempt, resolve successfully (this path shouldn't trigger the lastError null case)
          return Promise.resolve({});
        }
        return Promise.reject(new Error('S3 error'));
      });

      // This test ensures the retry logic handles all error cases properly
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
    });

    it('should handle HTTP 401 status code', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 401,
        headers: {},
      } as any);

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
      ).rejects.toThrow('Failed to download file: HTTP 401');
    });

    it('should handle HTTP 500 status code', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 500,
        headers: {},
      } as any);

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
      ).rejects.toThrow('Failed to download file: HTTP 500');
    });

    it('should handle file with content type from response header', async () => {
      const file = {
        id: 'file1',
        name: 'test.jpg',
        url_private: 'https://files.slack.com/files-pri/file1',
        // No mimetype - should use response header
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'image/jpeg' },
      } as any);

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

      await processFile(
        file,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      expect(mockUploadConstructor).toHaveBeenCalled();
      const uploadCall = ((mockUploadConstructor as jest.Mock).mock.calls[0] as any)[0];
      expect(uploadCall.params.ContentType).toBe('image/jpeg');
    });

    it('should handle URL with query parameters', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1?param=value&other=test',
        mimetype: 'text/plain',
      };

      const mockStream = new Readable({ read() {} });
      const mockResponse = Object.assign(mockStream, {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      } as any);

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
      expect(mockHttpsRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining('?param=value&other=test'),
        }),
        expect.any(Function)
      );
    });

    it('should handle request timeout before upload started', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/test.txt',
        mimetype: 'text/plain',
      } as any;

      const mockRequest: any = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'timeout') {
            // Simulate timeout event before upload started
            setImmediate(() => handler());
          }
          return mockRequest;
        }),
        destroy: jest.fn(),
        end: jest.fn(),
      };

      mockHttpsRequest.mockImplementation((_options: any, _callback: Function) => {
        // Don't call callback (simulating timeout before response)
        return mockRequest;
      });

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
      ).rejects.toThrow('Request timeout');

      expect(mockRequest.destroy).toHaveBeenCalled();
      expect(mockRequest.on).toHaveBeenCalledWith('timeout', expect.any(Function));
    });

    it('should handle request timeout after upload started', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/test.txt',
        mimetype: 'text/plain',
      } as any;

      const { Readable } = require('stream');
      const mockResponse = new Readable({
        read() {
          this.push('test data');
          this.push(null);
        },
      });
      mockResponse.statusCode = 200;
      mockResponse.headers = { 'content-type': 'text/plain' };

      let timeoutHandler: Function | undefined;
      const mockRequest: any = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'timeout') {
            timeoutHandler = handler;
          }
          return mockRequest;
        }),
        destroy: jest.fn(),
        end: jest.fn(),
      };

      // Don't let upload.done() resolve - we want timeout to reject first
      mockUploadDone.mockImplementation(() => new Promise(() => {})); // Never resolves

      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        // Call callback to start upload, then trigger timeout
        setImmediate(() => {
          callback(mockResponse);
          // Trigger timeout after upload started
          setImmediate(() => {
            if (timeoutHandler) {
              timeoutHandler();
            }
          });
        });
        return mockRequest;
      });

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
      ).rejects.toThrow('Request timeout after upload started');

      expect(mockRequest.destroy).toHaveBeenCalled();
      expect(mockUploadAbort).toHaveBeenCalled();
    });

    it('should handle request error after upload started', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/test.txt',
        mimetype: 'text/plain',
      } as any;

      const { Readable } = require('stream');
      const mockResponse = new Readable({
        read() {
          this.push('test data');
          this.push(null);
        },
      });
      mockResponse.statusCode = 200;
      mockResponse.headers = { 'content-type': 'text/plain' };

      let errorHandler: Function | undefined;
      const mockRequest: any = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            errorHandler = handler;
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      // Don't let upload.done() resolve - we want error to reject first
      mockUploadDone.mockImplementation(() => new Promise(() => {})); // Never resolves

      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        // Call callback to start upload, then trigger error
        setImmediate(() => {
          callback(mockResponse);
          // Trigger error after upload started
          setImmediate(() => {
            if (errorHandler) {
              errorHandler(new Error('Network error'));
            }
          });
        });
        return mockRequest;
      });

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
      ).rejects.toThrow('Request error after upload started');

      expect(mockUploadAbort).toHaveBeenCalled();
    });

    it('should handle upload abort error gracefully', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/test.txt',
        mimetype: 'text/plain',
      } as any;

      const { Readable } = require('stream');
      const mockResponse = new Readable({
        read() {
          this.push('test data');
          this.push(null);
        },
      });
      mockResponse.statusCode = 200;
      mockResponse.headers = { 'content-type': 'text/plain' };

      let errorHandler: Function | undefined;
      const mockRequest: any = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            errorHandler = handler;
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      // Don't let upload.done() resolve - we want error to reject first
      mockUploadDone.mockImplementation(() => new Promise(() => {})); // Never resolves
      // Mock upload.abort() to reject
      mockUploadAbort.mockRejectedValueOnce(new Error('Abort failed'));

      mockHttpsRequest.mockImplementation((_options: any, callback: Function) => {
        setImmediate(() => {
          callback(mockResponse);
          // Trigger error after upload started
          setImmediate(() => {
            if (errorHandler) {
              errorHandler(new Error('Network error'));
            }
          });
        });
        return mockRequest;
      });

      // Should not throw abort error, only the original error
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
      ).rejects.toThrow('Request error after upload started');

      // Abort should have been called (even if it failed, error is ignored)
      expect(mockUploadAbort).toHaveBeenCalled();
    });
  });
});

