import { handler } from '../index';
import { DynamoDBStreamEvent, Context } from 'aws-lambda';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('../config', () => ({
  loadConfig: jest.fn(),
}));

jest.mock('../stream-handler', () => ({
  processStreamRecord: jest.fn(),
}));

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  getOAuthCredentials: jest.fn(),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({})),
}));

describe('handler', () => {
  let mockLoadConfig: jest.Mock;
  let mockProcessStreamRecord: jest.Mock;
  let mockGetOAuthCredentials: jest.Mock;
  let mockS3Client: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    const configModule = require('../config');
    const streamHandlerModule = require('../stream-handler');
    const sharedModule = require('mnemosyne-slack-shared');
    const s3Module = require('@aws-sdk/client-s3');

    mockLoadConfig = configModule.loadConfig;
    mockProcessStreamRecord = streamHandlerModule.processStreamRecord;
    mockGetOAuthCredentials = sharedModule.getOAuthCredentials;
    mockS3Client = s3Module.S3Client;

    // Default mocks
    mockLoadConfig.mockReturnValue({
      oauthConfig: {
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      },
      bucketName: 'test-bucket',
    });

    mockGetOAuthCredentials.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    mockProcessStreamRecord.mockResolvedValue(undefined);
    mockS3Client.mockReturnValue({});
  });

  const createStreamEvent = (records: any[]): DynamoDBStreamEvent => ({
    Records: records,
  });

  const createStreamRecord = (overrides: any = {}) => ({
    eventID: 'test-event-id',
    eventName: 'INSERT',
    eventVersion: '1.0',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      ApproximateCreationDateTime: 1234567890,
      Keys: {
        itemId: { S: 'message#T123#C456' },
        timestamp: { S: '1234567890.123456' },
      },
      NewImage: {
        itemId: { S: 'message#T123#C456' },
        timestamp: { S: '1234567890.123456' },
        type: { S: 'message' },
      },
      SequenceNumber: '123456789',
      SizeBytes: 123,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
    ...overrides,
  });

  describe('processing records', () => {
    it('should process single record successfully', async () => {
      const event = createStreamEvent([createStreamRecord()]);
      const context = {} as Context;

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Processed 1 records');
      expect(mockLoadConfig).toHaveBeenCalled();
      expect(mockGetOAuthCredentials).toHaveBeenCalled();
      expect(mockProcessStreamRecord).toHaveBeenCalledTimes(1);
    });

    it('should process multiple records successfully', async () => {
      const event = createStreamEvent([
        createStreamRecord(),
        createStreamRecord({ eventID: 'test-event-id-2' }),
        createStreamRecord({ eventID: 'test-event-id-3' }),
      ]);
      const context = {} as Context;

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Processed 3 records');
      expect(mockProcessStreamRecord).toHaveBeenCalledTimes(3);
    });

    it('should process records independently', async () => {
      const event = createStreamEvent([
        createStreamRecord(),
        createStreamRecord({ eventID: 'test-event-id-2' }),
      ]);
      const context = {} as Context;

      await handler(event, context);

      expect(mockProcessStreamRecord).toHaveBeenCalledTimes(2);
      // Verify each record is processed with correct parameters
      const calls = mockProcessStreamRecord.mock.calls;
      expect(calls[0][0]).toEqual(expect.objectContaining({ eventID: 'test-event-id' }));
      expect(calls[1][0]).toEqual(expect.objectContaining({ eventID: 'test-event-id-2' }));
    });

    it('should continue processing on record failure', async () => {
      const event = createStreamEvent([
        createStreamRecord(),
        createStreamRecord({ eventID: 'test-event-id-2' }),
        createStreamRecord({ eventID: 'test-event-id-3' }),
      ]);
      const context = {} as Context;

      // First record fails, others succeed
      mockProcessStreamRecord
        .mockRejectedValueOnce(new Error('Processing failed'))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Processed 3 records');
      expect(mockProcessStreamRecord).toHaveBeenCalledTimes(3);
      // All records were attempted, despite first failure
    });

    it('should handle all records failing', async () => {
      const event = createStreamEvent([
        createStreamRecord(),
        createStreamRecord({ eventID: 'test-event-id-2' }),
      ]);
      const context = {} as Context;

      mockProcessStreamRecord.mockRejectedValue(new Error('Processing failed'));

      const result = await handler(event, context);

      // Handler still succeeds even if all records fail
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Processed 2 records');
      expect(mockProcessStreamRecord).toHaveBeenCalledTimes(2);
    });

    it('should handle empty records array', async () => {
      const event = createStreamEvent([]);
      const context = {} as Context;

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Processed 0 records');
      expect(mockProcessStreamRecord).not.toHaveBeenCalled();
    });
  });

  describe('configuration and initialization', () => {
    it('should load config and OAuth credentials', async () => {
      const event = createStreamEvent([createStreamRecord()]);
      const context = {} as Context;

      await handler(event, context);

      expect(mockLoadConfig).toHaveBeenCalled();
      expect(mockGetOAuthCredentials).toHaveBeenCalledWith({
        tableName: 'test-table',
        clientIdArn: 'arn:test',
        clientSecretArn: 'arn:test',
        region: 'us-east-1',
      });
    });

    it('should create S3 client with correct region', async () => {
      const event = createStreamEvent([createStreamRecord()]);
      const context = {} as Context;

      mockLoadConfig.mockReturnValue({
        oauthConfig: {
          tableName: 'test-table',
          clientIdArn: 'arn:test',
          clientSecretArn: 'arn:test',
          region: 'eu-west-1',
        },
        bucketName: 'test-bucket',
      });

      await handler(event, context);

      expect(mockS3Client).toHaveBeenCalledWith({ region: 'eu-west-1' });
    });

    it('should pass correct parameters to processStreamRecord', async () => {
      const event = createStreamEvent([createStreamRecord()]);
      const context = {} as Context;

      const mockS3ClientInstance = {};
      mockS3Client.mockReturnValue(mockS3ClientInstance);

      await handler(event, context);

      expect(mockProcessStreamRecord).toHaveBeenCalledWith(
        expect.objectContaining({ eventID: 'test-event-id' }),
        {
          tableName: 'test-table',
          clientIdArn: 'arn:test',
          clientSecretArn: 'arn:test',
          region: 'us-east-1',
        },
        'test-bucket',
        mockS3ClientInstance,
        'client-id',
        'client-secret'
      );
    });
  });

  describe('error handling', () => {
    it('should handle config loading errors', async () => {
      const event = createStreamEvent([createStreamRecord()]);
      const context = {} as Context;

      const configError = new Error('Config loading failed');
      mockLoadConfig.mockImplementation(() => {
        throw configError;
      });

      await expect(handler(event, context)).rejects.toThrow('Config loading failed');
    });

    it('should handle OAuth credentials errors', async () => {
      const event = createStreamEvent([createStreamRecord()]);
      const context = {} as Context;

      const oauthError = new Error('OAuth credentials failed');
      mockGetOAuthCredentials.mockRejectedValue(oauthError);

      await expect(handler(event, context)).rejects.toThrow('OAuth credentials failed');
    });

    it('should log errors for failed records', async () => {
      const event = createStreamEvent([
        createStreamRecord(),
        createStreamRecord({ eventID: 'test-event-id-2' }),
      ]);
      const context = {} as Context;

      const processingError = new Error('Record processing failed');
      mockProcessStreamRecord
        .mockRejectedValueOnce(processingError)
        .mockResolvedValueOnce(undefined);

      await handler(event, context);

      // Handler should log the error but continue
      expect(shared.logger.error).toHaveBeenCalledWith(
        'Failed to process stream record',
        processingError
      );
    });

    it('should handle different error types gracefully', async () => {
      const event = createStreamEvent([
        createStreamRecord(),
        createStreamRecord({ eventID: 'test-event-id-2' }),
      ]);
      const context = {} as Context;

      mockProcessStreamRecord
        .mockRejectedValueOnce('String error')
        .mockRejectedValueOnce({ code: 'CustomError', message: 'Custom error' })
        .mockResolvedValueOnce(undefined);

      const result = await handler(event, context);

      // Handler should still succeed
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Processed 3 records');
    });
  });
});

