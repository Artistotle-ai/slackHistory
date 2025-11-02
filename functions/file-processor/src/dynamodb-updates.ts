import { updateItem, DynamoDBKey } from 'mnemosyne-slack-shared';

/**
 * Update message with S3 keys for successfully processed files
 */
export async function updateMessageWithS3Keys(
  tableName: string,
  item: any,
  s3Keys: string[]
): Promise<void> {
  if (s3Keys.length === 0) {
    return;
  }

  const key: DynamoDBKey = {
    itemId: item.itemId,
    timestamp: item.timestamp,
  };

  await updateItem(
    tableName,
    key,
    'SET files_s3 = list_append(if_not_exists(files_s3, :empty_list), :new_s3_refs)',
    {
      ':empty_list': [],
      ':new_s3_refs': s3Keys,
    }
  );

  console.log(`Updated DynamoDB with ${s3Keys.length} S3 keys`);
}

/**
 * Mark message files as failed
 */
export async function markMessageFilesFailed(
  tableName: string,
  item: any,
  failedFiles: Array<{ file: any; error: Error }>
): Promise<void> {
  if (failedFiles.length === 0) {
    return;
  }

  const key: DynamoDBKey = {
    itemId: item.itemId,
    timestamp: item.timestamp,
  };

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

  console.log(`Marked ${failedFiles.length} file(s) as failed`);
}

/**
 * Mark entire message as failed
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

  console.log('Marked record as failed');
}

