import { DynamoDBStreamEvent, Context } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getValidBotToken, getDynamoDb, UpdateCommand, loadOAuthConfig, getOAuthCredentials, OAuthConfig } from 'mnemosyne-slack-shared';
import * as https from 'https';
import * as http from 'http';

/**
 * Load configuration from environment variables
 */
function loadConfig(): { oauthConfig: OAuthConfig; bucketName: string } {
  const oauthConfig = loadOAuthConfig();
  
  const bucketName = process.env.SLACK_FILES_BUCKET;
  if (!bucketName) {
    throw new Error('SLACK_FILES_BUCKET environment variable is required');
  }

  return { oauthConfig, bucketName };
}

/**
 * Stream file from Slack to S3 without loading into memory
 */
function streamFileFromSlackToS3(
  url: string,
  botToken: string,
  s3Key: string,
  bucketName: string,
  s3Client: S3Client,
  contentType?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Create HTTP request to Slack
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${botToken}`,
      },
    };

    const req = protocol.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download file: HTTP ${res.statusCode}`));
        return;
      }

      // Create S3 upload stream
      const uploadParams = {
        Bucket: bucketName,
        Key: s3Key,
        Body: res, // Stream directly from response
        ContentType: contentType || res.headers['content-type'] || 'application/octet-stream',
      };

      s3Client.send(new PutObjectCommand(uploadParams))
        .then(() => {
          console.log(`Successfully uploaded ${s3Key}`);
          resolve();
        })
        .catch((err: any) => {
          reject(new Error(`Failed to upload to S3: ${err.message}`));
        });
    });

      req.on('error', (err: Error) => {
        reject(new Error(`Failed to download from Slack: ${err.message}`));
      });

    req.end();
  });
}

/**
 * Download file from Slack and upload to S3 using streaming
 */
async function processFile(
  file: any,
  teamId: string,
  channelId: string,
  ts: string,
  botToken: string,
  bucketName: string,
  s3Client: S3Client
): Promise<string> {
  if (!file.url_private) {
    throw new Error(`File ${file.id} has no url_private - external file, skipping`);
  }

  const s3Key = `slack/${teamId}/${channelId}/${ts}/${file.id}`;

  console.log(`Processing file: ${file.id} (${file.name || 'unnamed'})`);

  // Stream file from Slack to S3
  await streamFileFromSlackToS3(
    file.url_private,
    botToken,
    s3Key,
    bucketName,
    s3Client,
    file.mimetype
  );

  return s3Key;
}

/**
 * Unmarshall DynamoDB item from stream format
 */
function unmarshallDynamoDBItem(item: any): any {
  const result: any = {};
  
  for (const [key, value] of Object.entries(item)) {
    if (!value || typeof value !== 'object') continue;
    
    const type = Object.keys(value)[0];
    const val = (value as any)[type];
    
    switch (type) {
      case 'S':
        result[key] = val;
        break;
      case 'N':
        result[key] = Number(val);
        break;
      case 'BOOL':
        result[key] = val;
        break;
      case 'NULL':
        result[key] = null;
        break;
      case 'L':
        result[key] = val.map((v: any) => unmarshallDynamoDBItem({ item: v }).item);
        break;
      case 'M':
        result[key] = unmarshallDynamoDBItem(val);
        break;
      case 'SS':
      case 'NS':
      case 'BS':
        result[key] = val;
        break;
      default:
        result[key] = val;
    }
  }
  
  return result;
}

/**
 * Main Lambda handler
 */
export const handler = async (event: DynamoDBStreamEvent, _context: Context) => {
  console.log('File Processor invoked with', event.Records.length, 'records');

  const config = loadConfig();
  const s3Client = new S3Client({ region: config.oauthConfig.region });
  const dynamoClient = getDynamoDb();

  // Get OAuth credentials (cached)
  const { clientId, clientSecret } = await getOAuthCredentials(config.oauthConfig);

  for (const record of event.Records) {
    // Only process INSERT and MODIFY events
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
      continue;
    }

    // Skip if old image is missing (deleted record)
    if (!record.dynamodb?.NewImage) {
      console.log('Skipping record - no NewImage');
      continue;
    }

    // Parse the DynamoDB item
    const item = unmarshallDynamoDBItem(record.dynamodb.NewImage) as any;

    // Only process message items with files that haven't been processed yet
    if (item.type !== 'message') {
      continue;
    }

    if (!item.files || item.files.length === 0) {
      continue;
    }

    if (item.files_s3 && item.files_s3.length === item.files.length) {
      console.log(`Skipping ${item.team_id}/${item.channel_id}/${item.ts} - already processed`);
      continue;
    }

    console.log(`Processing message with ${item.files.length} file(s)`);

    try {
      // Get valid bot token (auto-refreshes if needed)
      const botToken = await getValidBotToken(
        config.oauthConfig.tableName,
        item.team_id,
        clientId,
        clientSecret
      );

      // Process files
      const s3Keys: string[] = [];
      for (const file of item.files) {
        try {
          const s3Key = await processFile(
            file,
            item.team_id,
            item.channel_id,
            item.ts,
            botToken,
            config.bucketName,
            s3Client
          );
          s3Keys.push(s3Key);
        } catch (fileError) {
          console.error(`Failed to process file ${file.id}:`, fileError);
          // Continue with other files even if one fails
        }
      }

      // Update DynamoDB with S3 keys
      if (s3Keys.length > 0) {
        const updateParams = {
          TableName: config.oauthConfig.tableName,
          Key: {
            itemId: item.itemId,
            timestamp: item.timestamp,
          },
          UpdateExpression: 'SET files_s3 = list_append(if_not_exists(files_s3, :empty_list), :new_s3_refs)',
          ExpressionAttributeValues: {
            ':empty_list': [],
            ':new_s3_refs': s3Keys,
          },
        };

        await dynamoClient.send(new UpdateCommand(updateParams));
        console.log(`Updated DynamoDB with ${s3Keys.length} S3 keys`);
      }

      console.log(`Successfully processed ${s3Keys.length} of ${item.files.length} files`);

    } catch (error) {
      console.error('Failed to process record:', error);
      
      // Mark record as failed in DynamoDB
      try {
        const updateParams = {
          TableName: config.oauthConfig.tableName,
          Key: {
            itemId: item.itemId,
            timestamp: item.timestamp,
          },
          UpdateExpression: 'SET files_fetch_failed = :failed',
          ExpressionAttributeValues: {
            ':failed': true,
          },
        };

        await dynamoClient.send(new UpdateCommand(updateParams));
        console.log('Marked record as failed');
      } catch (updateError) {
        console.error('Failed to mark record as failed:', updateError);
      }
    }
  }

  return {
    statusCode: 200,
    message: `Processed ${event.Records.length} records`,
  };
};
