import { DynamoDBStreamEvent, Context } from 'aws-lambda';
import { getOAuthCredentials, OAuthConfig, logger } from 'mnemosyne-slack-shared';
import { processMessageFiles } from './file-processor';
import { maintainChannelIndex } from './channel-index';
import { 
  updateMessageWithS3Keys, 
  markMessageFilesFailed, 
  markMessageFailed 
} from './dynamodb-updates';

// Lazy load AWS SDK utilities (heavy dependencies)
let utilDynamoDbModule: typeof import('@aws-sdk/util-dynamodb') | null = null;

async function getUnmarshall() {
  if (!utilDynamoDbModule) {
    utilDynamoDbModule = await import('@aws-sdk/util-dynamodb');
  }
  return utilDynamoDbModule.unmarshall;
}


/**
 * Process a message item with files
 * 
 * Downloads files from Slack and uploads to S3. Handles partial failures
 * gracefully - some files may succeed while others fail. Updates DynamoDB
 * with S3 keys for successful downloads and marks failed files for retry.
 * 
 * @param item - Message item from DynamoDB stream
 * @param oauthConfig - OAuth configuration for token retrieval
 * @param bucketName - S3 bucket name for file storage
 * @param s3Client - S3 client instance
 * @param clientId - OAuth client ID
 * @param clientSecret - OAuth client secret
 */
async function processMessageItem(
  item: any,
  oauthConfig: OAuthConfig,
  bucketName: string,
  s3Client: any,
  clientId: string,
  clientSecret: string
): Promise<void> {
  // Skip if already fully processed (all files have S3 keys)
  // This provides idempotency - safe to reprocess stream records
  if (item.files_s3 && item.files_s3.length === item.files.length) {
    logger.debug(`Skipping ${item.team_id}/${item.channel_id}/${item.ts} - already processed`);
    return;
  }

  logger.info(`Processing message with ${item.files.length} file(s)`);

  try {
    // Process all files with retry logic
    // Returns both successful downloads (s3Keys) and failures (failedFiles)
    const { s3Keys, failedFiles } = await processMessageFiles(
      item,
      oauthConfig,
      bucketName,
      s3Client,
      clientId,
      clientSecret
    );

    // Update DynamoDB with S3 keys for successfully downloaded files
    // Uses list_append to add new keys without losing existing ones
    if (s3Keys.length > 0) {
      await updateMessageWithS3Keys(oauthConfig.tableName, item, s3Keys);
    }

    // Mark failed files in DynamoDB for monitoring/retry
    // Failed files can be retried later if needed
    if (failedFiles.length > 0) {
      await markMessageFilesFailed(oauthConfig.tableName, item, failedFiles);
    }

    logger.info(`Successfully processed ${s3Keys.length} of ${item.files.length} files`);

  } catch (error) {
    // Critical error - entire message processing failed (e.g., token refresh error)
    logger.error('Failed to process record', error);
    
    // Mark entire message as failed for monitoring
    try {
      await markMessageFailed(
        oauthConfig.tableName,
        item,
        error instanceof Error ? error : new Error(String(error))
      );
    } catch (updateError) {
      // Log but don't throw - avoid masking original error
      logger.error('Failed to mark record as failed', updateError);
    }
  }
}

/**
 * Process a single DynamoDB stream record
 * 
 * Routes stream records to appropriate handlers:
 * - Channel items → ChannelIndex maintenance
 * - Message items with files → File processing
 * 
 * Records are unmarshalled from DynamoDB native format to JavaScript objects.
 * OldImage is used for ChannelIndex to detect deletions (when deleted flag changes).
 * 
 * @param record - DynamoDB stream record (contains eventName and dynamodb.NewImage/OldImage)
 * @param oauthConfig - OAuth configuration
 * @param bucketName - S3 bucket name
 * @param s3Client - S3 client instance
 * @param clientId - OAuth client ID
 * @param clientSecret - OAuth client secret
 */
export async function processStreamRecord(
  record: any,
  oauthConfig: OAuthConfig,
  bucketName: string,
  s3Client: any,
  clientId: string,
  clientSecret: string
): Promise<void> {
  // Only process INSERT and MODIFY events
  // REMOVE events are skipped (deletions handled via deleted flag in channel items)
  if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
    return;
  }

  // Skip records without NewImage (shouldn't happen for INSERT/MODIFY, but safety check)
  if (!record.dynamodb?.NewImage) {
    logger.debug('Skipping record - no NewImage');
    return;
  }

  // Unmarshall DynamoDB native format to JavaScript objects
  // NewImage: current state of the item
  // OldImage: previous state (only present for MODIFY events)
  // Lazy load unmarshall when needed
  const unmarshall = await getUnmarshall();
  
  const item = record.dynamodb.NewImage 
    ? (unmarshall(record.dynamodb.NewImage) as any)
    : null;
  const oldItem = record.dynamodb?.OldImage 
    ? (unmarshall(record.dynamodb.OldImage) as any)
    : undefined;

  if (!item) {
    return;
  }

  // Route channel items to ChannelIndex maintenance
  // ChannelIndex maintains channel_id -> name mapping for efficient lookups
  if (item.itemId?.startsWith('channel#')) {
    try {
      await maintainChannelIndex(oauthConfig.tableName, item, oldItem);
    } catch (error) {
      logger.error('Failed to maintain ChannelIndex', error);
      // Continue processing other items even if ChannelIndex update fails
      // ChannelIndex is non-critical - can be rebuilt from channel items if needed
    }
    return; // Channel items don't have files, so stop here
  }

  // Route message items to file processing
  // Only process messages with files that haven't been fully processed
  if (item.type !== 'message') {
    return; // Not a message item
  }

  if (!item.files || item.files.length === 0) {
    return; // No files to process
  }

  // Process files: download from Slack and upload to S3
  await processMessageItem(
    item,
    oauthConfig,
    bucketName,
    s3Client,
    clientId,
    clientSecret
  );
}

