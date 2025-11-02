import { DynamoDBStreamEvent, Context } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { getOAuthCredentials } from 'mnemosyne-slack-shared';
import { loadConfig } from './config';
import { processStreamRecord } from './stream-handler';

/**
 * Main Lambda handler
 */
export const handler = async (event: DynamoDBStreamEvent, _context: Context) => {
  console.log('File Processor invoked with', event.Records.length, 'records');

  const config = loadConfig();
  const s3Client = new S3Client({ region: config.oauthConfig.region });

  // Get OAuth credentials (cached)
  const { clientId, clientSecret } = await getOAuthCredentials(config.oauthConfig);

  // Process each record
  for (const record of event.Records) {
    try {
      await processStreamRecord(
        record,
        config.oauthConfig,
        config.bucketName,
        s3Client,
        clientId,
        clientSecret
      );
    } catch (error) {
      console.error('Failed to process stream record:', error);
      // Continue with other records even if one fails
    }
  }

  return {
    statusCode: 200,
    message: `Processed ${event.Records.length} records`,
  };
};
