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
  request: mockHttpRequest,
}));

jest.mock('https', () => ({
  request: mockHttpsRequest,
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3Client),
  PutObjectCommand: jest.fn((params: any) => ({ params })),
}));

describe('file-processor', () => {
  const mockGetValidBotToken = shared.getValidBotToken as jest.Mock;
  const mockS3Send = mockS3Client.send as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetValidBotToken.mockResolvedValue('bot-token-123');
    mockS3Send.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
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
      const mockRequest = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            // Simulate successful request
            setTimeout(() => {
              const mockResponse = {
                statusCode: 200,
                headers: { 'content-type': 'text/plain' },
                on: jest.fn((event: string, handler: Function) => {
                  if (event === 'end') {
                    setTimeout(() => handler(), 0);
                  }
                }),
              };
              handler(mockResponse);
            }, 0);
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockReturnValue(mockRequest);

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
      const mockRequest = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            attemptCount++;
            if (attemptCount < 3) {
              // Fail first two attempts
              setTimeout(() => handler(new Error('Network error')), 0);
            } else {
              // Succeed on third attempt
              setTimeout(() => {
                const mockResponse = {
                  statusCode: 200,
                  headers: { 'content-type': 'text/plain' },
                  on: jest.fn((event: string, handler: Function) => {
                    if (event === 'end') {
                      setTimeout(() => handler(), 0);
                    }
                  }),
                };
                handler(mockResponse);
              }, 0);
            }
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockReturnValue(mockRequest);
      mockS3Send
        .mockRejectedValueOnce(new Error('S3 error 1'))
        .mockRejectedValueOnce(new Error('S3 error 2'))
        .mockResolvedValueOnce({});

      const promise = processFile(
        file,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      // Fast-forward timers for retry delays
      jest.advanceTimersByTime(1000); // First retry delay
      jest.advanceTimersByTime(2000); // Second retry delay

      await promise;

      expect(mockS3Send).toHaveBeenCalledTimes(3);
    });

    it('should throw error if all retries fail', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'https://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockRequest = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('Network error')), 0);
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockReturnValue(mockRequest);
      mockS3Send.mockRejectedValue(new Error('S3 error'));

      const promise = processFile(
        file,
        'T123',
        'C456',
        '1234567890.123456',
        'bot-token',
        'test-bucket',
        mockS3Client
      );

      // Fast-forward through retries
      jest.advanceTimersByTime(1000);
      jest.advanceTimersByTime(2000);
      jest.advanceTimersByTime(4000);

      await expect(promise).rejects.toThrow();
    });

    it('should handle HTTP 200 response', async () => {
      const file = {
        id: 'file1',
        name: 'test.txt',
        url_private: 'http://files.slack.com/files-pri/file1',
        mimetype: 'text/plain',
      };

      const mockRequest = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            setTimeout(() => {
              const mockResponse = {
                statusCode: 200,
                headers: { 'content-type': 'text/plain' },
                on: jest.fn((event: string, handler: Function) => {
                  if (event === 'end') {
                    setTimeout(() => handler(), 0);
                  }
                }),
              };
              handler(mockResponse);
            }, 0);
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpRequest.mockReturnValue(mockRequest);

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

      const mockRequest = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            setTimeout(() => {
              const mockResponse = {
                statusCode: 404,
                headers: {},
              };
              handler(mockResponse);
            }, 0);
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockReturnValue(mockRequest);

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
      const mockRequest = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            setTimeout(() => {
              const mockResponse = {
                statusCode: 200,
                headers: { 'content-type': 'text/plain' },
                on: jest.fn((event: string, handler: Function) => {
                  if (event === 'end') {
                    setTimeout(() => handler(), 0);
                  }
                }),
              };
              handler(mockResponse);
            }, 0);
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockReturnValue(mockRequest);

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
      const mockRequest = {
        on: jest.fn((event: string, handler: Function) => {
          if (event === 'error') {
            setTimeout(() => {
              const mockResponse = {
                statusCode: 200,
                headers: { 'content-type': 'text/plain' },
                on: jest.fn((event: string, handler: Function) => {
                  if (event === 'end') {
                    setTimeout(() => handler(), 0);
                  }
                }),
              };
              handler(mockResponse);
            }, 0);
          }
          return mockRequest;
        }),
        end: jest.fn(),
      };

      mockHttpsRequest.mockReturnValue(mockRequest);

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

