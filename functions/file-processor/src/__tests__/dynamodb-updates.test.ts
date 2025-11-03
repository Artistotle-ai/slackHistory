import {
  updateMessageWithS3Keys,
  markMessageFilesFailed,
  markMessageFailed,
} from '../dynamodb-updates';
import * as shared from 'mnemosyne-slack-shared';

jest.mock('mnemosyne-slack-shared', () => ({
  ...jest.requireActual('mnemosyne-slack-shared'),
  updateItem: jest.fn(),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('dynamodb-updates', () => {
  const mockUpdateItem = shared.updateItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateItem.mockResolvedValue(undefined);
  });

  describe('updateMessageWithS3Keys', () => {
    it('should update message with S3 keys', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        timestamp: '1234567890.123456',
        team_id: 'T123',
        channel_id: 'C456',
      };
      const s3Keys = ['slack/T123/C456/1234567890.123456/file1', 'slack/T123/C456/1234567890.123456/file2'];

      await updateMessageWithS3Keys(tableName, item, s3Keys);

      expect(mockUpdateItem).toHaveBeenCalledWith(
        tableName,
        { itemId: item.itemId, timestamp: item.timestamp },
        'SET files_s3 = list_append(if_not_exists(files_s3, :empty_list), :new_s3_refs)',
        {
          ':empty_list': [],
          ':new_s3_refs': s3Keys,
        }
      );
    });

    it('should not update if s3Keys array is empty', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        timestamp: '1234567890.123456',
      };

      await updateMessageWithS3Keys(tableName, item, []);

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('should handle update errors', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        timestamp: '1234567890.123456',
      };
      const s3Keys = ['slack/T123/C456/1234567890.123456/file1'];
      const error = new Error('DynamoDB error');

      mockUpdateItem.mockRejectedValue(error);

      await expect(updateMessageWithS3Keys(tableName, item, s3Keys)).rejects.toThrow('DynamoDB error');
    });
  });

  describe('markMessageFilesFailed', () => {
    it('should mark message files as failed', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        timestamp: '1234567890.123456',
      };
      const failedFiles = [
        { file: { id: 'file1', name: 'test1.txt' }, error: new Error('Download failed') },
        { file: { id: 'file2', name: 'test2.txt' }, error: new Error('Upload failed') },
      ];

      await markMessageFilesFailed(tableName, item, failedFiles);

      expect(mockUpdateItem).toHaveBeenCalledWith(
        tableName,
        { itemId: item.itemId, timestamp: item.timestamp },
        'SET files_fetch_failed = :failed, files_fetch_error = :error',
        {
          ':failed': true,
          ':error': 'Failed to process 2 file(s): file1, file2',
        }
      );
    });

    it('should not update if failedFiles array is empty', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        timestamp: '1234567890.123456',
      };

      await markMessageFilesFailed(tableName, item, []);

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('should handle single failed file', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        timestamp: '1234567890.123456',
      };
      const failedFiles = [
        { file: { id: 'file1' }, error: new Error('Download failed') },
      ];

      await markMessageFilesFailed(tableName, item, failedFiles);

      expect(mockUpdateItem).toHaveBeenCalledWith(
        tableName,
        { itemId: item.itemId, timestamp: item.timestamp },
        'SET files_fetch_failed = :failed, files_fetch_error = :error',
        {
          ':failed': true,
          ':error': 'Failed to process 1 file(s): file1',
        }
      );
    });
  });

  describe('markMessageFailed', () => {
    it('should mark entire message as failed', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        timestamp: '1234567890.123456',
      };
      const error = new Error('Processing failed');

      await markMessageFailed(tableName, item, error);

      expect(mockUpdateItem).toHaveBeenCalledWith(
        tableName,
        { itemId: item.itemId, timestamp: item.timestamp },
        'SET files_fetch_failed = :failed, files_fetch_error = :error',
        {
          ':failed': true,
          ':error': 'Processing failed',
        }
      );
    });

    it('should handle update errors', async () => {
      const tableName = 'test-table';
      const item = {
        itemId: 'message#T123#C456',
        timestamp: '1234567890.123456',
      };
      const error = new Error('Processing failed');
      const updateError = new Error('DynamoDB error');

      mockUpdateItem.mockRejectedValue(updateError);

      await expect(markMessageFailed(tableName, item, error)).rejects.toThrow('DynamoDB error');
    });
  });
});

