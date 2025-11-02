import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getValidBotToken } from 'mnemosyne-slack-shared';
import * as https from 'https';
import * as http from 'http';
import { OAuthConfig } from 'mnemosyne-slack-shared';

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
 * Retry with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxAttempts) {
        break;
      }
      
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError || new Error('Max retry attempts exceeded');
}

/**
 * Download file from Slack and upload to S3 using streaming with retry logic
 */
export async function processFile(
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

  // Stream file from Slack to S3 with retry logic
  await retryWithBackoff(
    () => streamFileFromSlackToS3(
      file.url_private,
      botToken,
      s3Key,
      bucketName,
      s3Client,
      file.mimetype
    ),
    3, // Max 3 attempts
    1000 // Base delay 1 second
  );

  return s3Key;
}

/**
 * Process all files in a message
 */
export async function processMessageFiles(
  item: any,
  oauthConfig: OAuthConfig,
  bucketName: string,
  s3Client: S3Client,
  clientId: string,
  clientSecret: string
): Promise<{ s3Keys: string[]; failedFiles: Array<{ file: any; error: Error }> }> {
  // Get valid bot token (auto-refreshes if needed)
  const botToken = await getValidBotToken(
    oauthConfig.tableName,
    item.team_id,
    clientId,
    clientSecret
  );

  const s3Keys: string[] = [];
  const failedFiles: Array<{ file: any; error: Error }> = [];
  
  for (const file of item.files) {
    try {
      const s3Key = await processFile(
        file,
        item.team_id,
        item.channel_id,
        item.ts,
        botToken,
        bucketName,
        s3Client
      );
      s3Keys.push(s3Key);
    } catch (fileError) {
      console.error(`Failed to process file ${file.id} after retries:`, fileError);
      failedFiles.push({ file, error: fileError as Error });
    }
  }

  return { s3Keys, failedFiles };
}

