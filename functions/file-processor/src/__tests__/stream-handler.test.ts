import { processStreamRecord } from '../stream-handler';
import * as fileProcessor from '../file-processor';
import * as channelIndex from '../channel-index';
import * as dynamodbUpdates from '../dynamodb-updates';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('../file-processor');
jest.mock('../channel-index');
jest.mock('../dynamodb-updates');
jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  unmarshall: jest.fn(),
}));

describe('stream-handler', () => {
  const mockProcessMessageFiles = fileProcessor.processMessageFiles as jest.Mock;
  const mockMaintainChannelIndex = channelIndex.maintainChannelIndex as jest.Mock;
  const mockUpdateMessageWithS3Keys = dynamodbUpdates.updateMessageWithS3Keys as jest.Mock;
  const mockMarkMessageFilesFailed = dynamodbUpdates.markMessageFilesFailed as jest.Mock;
  const mockMarkMessageFailed = dynamodbUpdates.markMessageFailed as jest.Mock;
  
  const utilDynamodb = require('@aws-sdk/util-dynamodb');
  const mockUnmarshallUtil = utilDynamodb.unmarshall as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUnmarshallUtil.mockImplementation((item: any) => item);
    mockProcessMessageFiles.mockResolvedValue({ s3Keys: [], failedFiles: [] });
    mockMaintainChannelIndex.mockResolvedValue(undefined);
    mockUpdateMessageWithS3Keys.mockResolvedValue(undefined);
    mockMarkMessageFilesFailed.mockResolvedValue(undefined);
    mockMarkMessageFailed.mockResolvedValue(undefined);
  });

  describe('processStreamRecord', () => {
    const oauthConfig = {
      tableName: 'test-table',
      clientIdArn: 'arn:test',
      clientSecretArn: 'arn:test',
      region: 'us-east-1',
    };
    const bucketName = 'test-bucket';
    const s3Client = {};
    const clientId = 'client-id';
    const clientSecret = 'client-secret';

    it('should skip REMOVE events', async () => {
      const record = {
        eventName: 'REMOVE',
        dynamodb: {
          NewImage: { S: 'test' },
        },
      };

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockUnmarshallUtil).not.toHaveBeenCalled();
      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
      expect(mockMaintainChannelIndex).not.toHaveBeenCalled();
    });

    it('should skip records without NewImage', async () => {
      const record = {
        eventName: 'INSERT',
        dynamodb: {},
      };

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockUnmarshallUtil).not.toHaveBeenCalled();
    });

    it('should skip if item is null after unmarshalling', async () => {
      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: { S: 'test' },
        },
      };

      mockUnmarshallUtil.mockReturnValue(null);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
    });

    it('should process channel items', async () => {
      const channelItem = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: channelItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(channelItem);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockMaintainChannelIndex).toHaveBeenCalledWith(
        oauthConfig.tableName,
        channelItem,
        undefined
      );
      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
    });

    it('should process channel items with OldImage for MODIFY events', async () => {
      const channelItem = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'new-name',
      };

      const oldChannelItem = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'old-name',
      };

      const record = {
        eventName: 'MODIFY',
        dynamodb: {
          NewImage: channelItem,
          OldImage: oldChannelItem,
        },
      };

      mockUnmarshallUtil
        .mockReturnValueOnce(channelItem)
        .mockReturnValueOnce(oldChannelItem);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockMaintainChannelIndex).toHaveBeenCalledWith(
        oauthConfig.tableName,
        channelItem,
        oldChannelItem
      );
    });

    it('should skip non-message items', async () => {
      const item = {
        itemId: 'other#T123',
        type: 'other',
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: item,
        },
      };

      mockUnmarshallUtil.mockReturnValue(item);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
    });

    it('should skip messages without files', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
    });

    it('should skip messages already fully processed', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [{ id: 'file1' }, { id: 'file2' }],
        files_s3: ['s3://bucket/file1', 's3://bucket/file2'],
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
    });

    it('should process message with files', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [
          {
            id: 'file1',
            url_private: 'https://files.slack.com/files-pri/file1',
          },
        ],
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);
      mockProcessMessageFiles.mockResolvedValue({
        s3Keys: ['slack/T123/C456/1234567890.123456/file1'],
        failedFiles: [],
      });

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockProcessMessageFiles).toHaveBeenCalledWith(
        messageItem,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );
      expect(mockUpdateMessageWithS3Keys).toHaveBeenCalledWith(
        oauthConfig.tableName,
        messageItem,
        ['slack/T123/C456/1234567890.123456/file1']
      );
      expect(mockMarkMessageFilesFailed).not.toHaveBeenCalled();
    });

    it('should handle partial file processing failures', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [
          { id: 'file1', url_private: 'https://files.slack.com/files-pri/file1' },
          { id: 'file2' }, // Missing url_private
        ],
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);
      mockProcessMessageFiles.mockResolvedValue({
        s3Keys: ['slack/T123/C456/1234567890.123456/file1'],
        failedFiles: [
          { file: { id: 'file2' }, error: new Error('No url_private') },
        ],
      });

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockUpdateMessageWithS3Keys).toHaveBeenCalledWith(
        oauthConfig.tableName,
        messageItem,
        ['slack/T123/C456/1234567890.123456/file1']
      );
      expect(mockMarkMessageFilesFailed).toHaveBeenCalledWith(
        oauthConfig.tableName,
        messageItem,
        [{ file: { id: 'file2' }, error: expect.any(Error) }]
      );
    });

    it('should mark message as failed on critical error', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [{ id: 'file1', url_private: 'https://files.slack.com/files-pri/file1' }],
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);
      const criticalError = new Error('Token refresh failed');
      mockProcessMessageFiles.mockRejectedValue(criticalError);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockMarkMessageFailed).toHaveBeenCalledWith(
        oauthConfig.tableName,
        messageItem,
        criticalError
      );
      expect(mockUpdateMessageWithS3Keys).not.toHaveBeenCalled();
    });

    it('should handle ChannelIndex maintenance failures gracefully', async () => {
      const channelItem = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: channelItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(channelItem);
      const indexError = new Error('ChannelIndex error');
      mockMaintainChannelIndex.mockRejectedValue(indexError);

      // Should not throw
      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockMaintainChannelIndex).toHaveBeenCalled();
    });

    it('should handle DynamoDB update failures gracefully', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [{ id: 'file1', url_private: 'https://files.slack.com/files-pri/file1' }],
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);
      mockProcessMessageFiles.mockResolvedValue({
        s3Keys: ['slack/T123/C456/1234567890.123456/file1'],
        failedFiles: [],
      });

      const updateError = new Error('DynamoDB update failed');
      mockUpdateMessageWithS3Keys.mockRejectedValue(updateError);

      // The function catches errors and marks message as failed, so it doesn't throw
      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      // Verify that the message was marked as failed
      expect(mockMarkMessageFailed).toHaveBeenCalled();
    });

    it('should handle markMessageFailed error gracefully', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [{ id: 'file1', url_private: 'https://files.slack.com/files-pri/file1' }],
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);
      const criticalError = new Error('Token refresh failed');
      mockProcessMessageFiles.mockRejectedValue(criticalError);
      
      const markFailedError = new Error('Mark failed error');
      mockMarkMessageFailed.mockRejectedValue(markFailedError);

      // Should not throw - error is caught and logged
      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockMarkMessageFailed).toHaveBeenCalled();
      expect(shared.logger.error).toHaveBeenCalledWith(
        'Failed to mark record as failed',
        markFailedError
      );
    });

    it('should handle non-Error exceptions when marking failed', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [{ id: 'file1', url_private: 'https://files.slack.com/files-pri/file1' }],
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);
      mockProcessMessageFiles.mockRejectedValue('String error');

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockMarkMessageFailed).toHaveBeenCalledWith(
        oauthConfig.tableName,
        messageItem,
        expect.any(Error)
      );
    });

    it('should skip when OldImage unmarshalling fails', async () => {
      const channelItem = {
        itemId: 'channel#T123',
        team_id: 'T123',
        channel_id: 'C456',
        name: 'test-channel',
      };

      const record = {
        eventName: 'MODIFY',
        dynamodb: {
          NewImage: channelItem,
          OldImage: null,
        },
      };

      mockUnmarshallUtil
        .mockReturnValueOnce(channelItem)
        .mockReturnValueOnce(null);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockMaintainChannelIndex).toHaveBeenCalledWith(
        oauthConfig.tableName,
        channelItem,
        undefined
      );
    });





    it('should handle item with type undefined', async () => {
      const item = {
        itemId: 'other#T123',
        // type is undefined
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: item,
        },
      };

      mockUnmarshallUtil.mockReturnValue(item);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
    });

    it('should handle item with files as empty array', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: [], // Empty array
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
    });

    it('should handle item with files as null', async () => {
      const messageItem = {
        itemId: 'message#T123#C456',
        type: 'message',
        team_id: 'T123',
        channel_id: 'C456',
        ts: '1234567890.123456',
        files: null,
      };

      const record = {
        eventName: 'INSERT',
        dynamodb: {
          NewImage: messageItem,
        },
      };

      mockUnmarshallUtil.mockReturnValue(messageItem);

      await processStreamRecord(
        record as any,
        oauthConfig,
        bucketName,
        s3Client,
        clientId,
        clientSecret
      );

      expect(mockProcessMessageFiles).not.toHaveBeenCalled();
    });
  });
});

