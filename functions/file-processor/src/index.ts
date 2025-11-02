import { DynamoDBStreamEvent, Context } from 'aws-lambda';
import { logger } from 'mnemosyne-slack-shared';

// Lazy load modules for better cold start performance
let oauthModule: typeof import('mnemosyne-slack-shared') | null = null;
let configModule: typeof import('./config') | null = null;
let streamHandlerModule: typeof import('./stream-handler') | null = null;

/**
 * Lazy load OAuth credentials module (only when needed)
 */
async function getOAuthCredentials(config: any) {
  if (!oauthModule) {
    oauthModule = await import('mnemosyne-slack-shared');
  }
  return oauthModule.getOAuthCredentials(config);
}

/**
 * Lazy load config module (only when needed)
 */
async function getConfigModule() {
  if (!configModule) {
    configModule = await import('./config.js');
  }
  return configModule;
}

/**
 * Lazy load stream handler (only when processing records)
 */
async function getStreamHandlerModule() {
  if (!streamHandlerModule) {
    streamHandlerModule = await import('./stream-handler.js');
  }
  return streamHandlerModule;
}

// Lazy load S3Client (heavy AWS SDK dependency)
let s3ClientModule: typeof import('@aws-sdk/client-s3') | null = null;

async function getS3Client(region: string): Promise<any> {
  if (!s3ClientModule) {
    s3ClientModule = await import('@aws-sdk/client-s3');
  }
  return new s3ClientModule.S3Client({ region });
}

/**
 * Main Lambda handler for DynamoDB stream events
 * 
 * Processes DynamoDB stream records triggered by changes to SlackArchive table.
 * Each record is processed independently - failures in one record don't stop
 * processing of others. This ensures maximum throughput and resilience.
 * 
 * @param event - DynamoDB stream event containing multiple records
 * @param _context - Lambda context (unused)
 * @returns Processing summary
 */
export const handler = async (event: DynamoDBStreamEvent, _context: Context) => {
  logger.info(`File Processor invoked with ${event.Records.length} records`);

  // Lazy load config module when needed
  const configMod = await getConfigModule();
  const config = configMod.loadConfig();
  
  // Lazy load S3 client when needed
  const s3Client = await getS3Client(config.oauthConfig.region);

  // Get OAuth credentials (cached for performance)
  // Credentials are needed to retrieve bot token from DynamoDB
  // Lazy load OAuth module when needed
  const { clientId, clientSecret } = await getOAuthCredentials(config.oauthConfig);

  // Lazy load stream handler module when needed
  const streamHandler = await getStreamHandlerModule();

  // Process each record independently
  // Failures in one record don't block processing of others
  for (const record of event.Records) {
    try {
      await streamHandler.processStreamRecord(
        record,
        config.oauthConfig,
        config.bucketName,
        s3Client,
        clientId,
        clientSecret
      );
    } catch (error) {
      // Log error but continue processing other records
      // This ensures partial batch failures don't block all records
      logger.error('Failed to process stream record', error);
    }
  }

  return {
    statusCode: 200,
    message: `Processed ${event.Records.length} records`,
  };
};
