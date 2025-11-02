import { DynamoDBStreamEvent, Context } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { getOAuthCredentials, OAuthConfig } from 'mnemosyne-slack-shared';
import { processMessageFiles } from './file-processor';
import { maintainChannelIndex } from './channel-index';
import { 
  updateMessageWithS3Keys, 
  markMessageFilesFailed, 
  markMessageFailed 
} from './dynamodb-updates';

/**
 * Process a channel item for ChannelIndex maintenance
 */
async function processChannelItem(
  item: any,
  oldItem: any | undefined,
  oauthConfig: OAuthConfig
): Promise<void> {
  await maintainChannelIndex(oauthConfig.tableName, item, oldItem);
}

/**
 * Process a message item with files
 */
async function processMessageItem(
  item: any,
  oauthConfig: OAuthConfig,
  bucketName: string,
  s3Client: S3Client,
  clientId: string,
  clientSecret: string
): Promise<void> {
  // Skip if already fully processed
  if (item.files_s3 && item.files_s3.length === item.files.length) {
    console.log(`Skipping ${item.team_id}/${item.channel_id}/${item.ts} - already processed`);
    return;
  }

  console.log(`Processing message with ${item.files.length} file(s)`);

  try {
    // Process all files
    const { s3Keys, failedFiles } = await processMessageFiles(
      item,
      oauthConfig,
      bucketName,
      s3Client,
      clientId,
      clientSecret
    );

    // Update DynamoDB with S3 keys
    if (s3Keys.length > 0) {
      await updateMessageWithS3Keys(oauthConfig.tableName, item, s3Keys);
    }

    // Mark failed files if any
    if (failedFiles.length > 0) {
      await markMessageFilesFailed(oauthConfig.tableName, item, failedFiles);
    }

    console.log(`Successfully processed ${s3Keys.length} of ${item.files.length} files`);

  } catch (error) {
    console.error('Failed to process record:', error);
    
    // Mark entire message as failed
    try {
      await markMessageFailed(
        oauthConfig.tableName,
        item,
        error instanceof Error ? error : new Error(String(error))
      );
    } catch (updateError) {
      console.error('Failed to mark record as failed:', updateError);
    }
  }
}

/**
 * Process a single stream record
 */
export async function processStreamRecord(
  record: any,
  oauthConfig: OAuthConfig,
  bucketName: string,
  s3Client: S3Client,
  clientId: string,
  clientSecret: string
): Promise<void> {
  // Only process INSERT and MODIFY events
  if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
    return;
  }

  // Skip if old image is missing (deleted record)
  if (!record.dynamodb?.NewImage) {
    console.log('Skipping record - no NewImage');
    return;
  }

  // Parse the DynamoDB item (using AWS SDK unmarshall)
  const item = record.dynamodb.NewImage 
    ? (unmarshall(record.dynamodb.NewImage) as any)
    : null;
  const oldItem = record.dynamodb?.OldImage 
    ? (unmarshall(record.dynamodb.OldImage) as any)
    : undefined;

  if (!item) {
    return;
  }

  // Handle ChannelIndex maintenance for channel items
  if (item.itemId?.startsWith('channel#')) {
    try {
      await processChannelItem(item, oldItem, oauthConfig);
    } catch (error) {
      console.error('Failed to maintain ChannelIndex:', error);
      // Continue processing other items even if ChannelIndex update fails
    }
    return;
  }

  // Process message items with files that haven't been processed yet
  if (item.type !== 'message') {
    return;
  }

  if (!item.files || item.files.length === 0) {
    return;
  }

  await processMessageItem(
    item,
    oauthConfig,
    bucketName,
    s3Client,
    clientId,
    clientSecret
  );
}

