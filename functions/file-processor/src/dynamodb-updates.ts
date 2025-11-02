import { updateItem, DynamoDBKey, logger } from 'mnemosyne-slack-shared';

/**
 * Update message with S3 keys for successfully processed files
 * 
 * Appends new S3 keys to the files_s3 array in DynamoDB. Uses list_append
 * to add keys without losing existing ones (important for partial retries).
 * 
 * @param tableName - DynamoDB table name
 * @param item - Message item (contains itemId and timestamp for key lookup)
 * @param s3Keys - Array of S3 keys (format: slack/{team_id}/{channel_id}/{ts}/{file_id})
 */
export async function updateMessageWithS3Keys(
  tableName: string,
  item: any,
  s3Keys: string[]
): Promise<void> {
  if (s3Keys.length === 0) {
    return; // Nothing to update
  }

  const key: DynamoDBKey = {
    itemId: item.itemId,
    timestamp: item.timestamp,
  };

  // Use list_append to add new keys to existing array (or create new array if none exists)
  // This is idempotent-safe - can be called multiple times without duplicates
  await updateItem(
    tableName,
    key,
    'SET files_s3 = list_append(if_not_exists(files_s3, :empty_list), :new_s3_refs)',
    {
      ':empty_list': [],
      ':new_s3_refs': s3Keys,
    }
  );

  logger.debug(`Updated DynamoDB with ${s3Keys.length} S3 keys`);
}

/**
 * Mark message files as failed in DynamoDB
 * 
 * Records partial failures when some files in a message fail to download.
 * This allows monitoring and potential retry of failed files without affecting
 * successfully processed files.
 * 
 * @param tableName - DynamoDB table name
 * @param item - Message item
 * @param failedFiles - Array of failed file metadata with error details
 */
export async function markMessageFilesFailed(
  tableName: string,
  item: any,
  failedFiles: Array<{ file: any; error: Error }>
): Promise<void> {
  if (failedFiles.length === 0) {
    return; // Nothing to mark as failed
  }

  const key: DynamoDBKey = {
    itemId: item.itemId,
    timestamp: item.timestamp,
  };

  // Record failure details for monitoring/retry
  const updateExpression = 'SET files_fetch_failed = :failed, files_fetch_error = :error';
  const expressionAttributeValues: Record<string, any> = {
    ':failed': true,
    ':error': `Failed to process ${failedFiles.length} file(s): ${failedFiles.map(f => f.file.id).join(', ')}`,
  };

  await updateItem(
    tableName,
    key,
    updateExpression,
    expressionAttributeValues
  );

  logger.warn(`Marked ${failedFiles.length} file(s) as failed`);
}

/**
 * Mark entire message as failed in DynamoDB
 * 
 * Records critical failures when message processing fails entirely (e.g.,
 * token refresh errors, configuration issues). Used when partial failure
 * tracking isn't applicable.
 * 
 * @param tableName - DynamoDB table name
 * @param item - Message item
 * @param error - Error that caused the failure
 */
export async function markMessageFailed(
  tableName: string,
  item: any,
  error: Error
): Promise<void> {
  const key: DynamoDBKey = {
    itemId: item.itemId,
    timestamp: item.timestamp,
  };

  await updateItem(
    tableName,
    key,
    'SET files_fetch_failed = :failed, files_fetch_error = :error',
    {
      ':failed': true,
      ':error': error.message,
    }
  );

  logger.warn('Marked record as failed');
}

