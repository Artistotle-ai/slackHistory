// Lazy load AWS SDK and Node.js modules for better cold start performance
// These heavy dependencies are only loaded when file processing is actually needed
let s3ClientModule: typeof import('@aws-sdk/client-s3') | null = null;
let httpModule: typeof import('http') | null = null;
let httpsModule: typeof import('https') | null = null;
let streamModule: typeof import('stream') | null = null;

import { getValidBotToken, logger } from 'mnemosyne-slack-shared';
import { OAuthConfig } from 'mnemosyne-slack-shared';

/**
 * Lazy load S3 client module
 */
async function getS3Module() {
  if (!s3ClientModule) {
    s3ClientModule = await import('@aws-sdk/client-s3');
  }
  return s3ClientModule;
}

/**
 * Lazy load HTTP module
 */
function getHttpModule() {
  if (!httpModule) {
    httpModule = require('http') as typeof import('http');
  }
  return httpModule;
}

/**
 * Lazy load HTTPS module
 */
function getHttpsModule() {
  if (!httpsModule) {
    httpsModule = require('https') as typeof import('https');
  }
  return httpsModule;
}

/**
 * Lazy load Stream module
 */
function getStreamModule() {
  if (!streamModule) {
    streamModule = require('stream') as typeof import('stream');
  }
  return streamModule;
}

/**
 * Stream file from Slack to S3 without loading into memory
 * 
 * This function streams data directly from Slack's API response to S3,
 * avoiding loading large files into Lambda memory. This is critical for
 * memory efficiency and to stay within Lambda's memory limits.
 * 
 * @param url - Slack file URL (url_private from file metadata)
 * @param botToken - Bot OAuth token for authentication
 * @param s3Key - S3 key where file will be stored
 * @param bucketName - S3 bucket name
 * @param s3Client - S3 client instance
 * @param contentType - Optional content type (falls back to response header or octet-stream)
 */
async function streamFileFromSlackToS3(
  url: string,
  botToken: string,
  s3Key: string,
  bucketName: string,
  s3Client: any,
  contentType?: string
): Promise<void> {
  // Lazy load modules when actually needed
  const s3Module = await getS3Module();
  const http = getHttpModule();
  const https = getHttpsModule();

  return new Promise((resolve, reject) => {
    // Parse URL to determine protocol (https/http)
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    const streamMod = getStreamModule();

    // Use PassThrough stream as intermediary to handle errors better
    // This allows proper error handling and prevents "non-retryable streaming request" errors
    const passThrough = new streamMod.PassThrough();
    let uploadStarted = false;
    let uploadCompleted = false;

    // Configure HTTP request to Slack API
    // Set timeout to prevent hanging requests (5 minutes max for large files)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${botToken}`,
      },
      timeout: 300000, // 5 minutes timeout for large file downloads
    };

    // Create HTTP request and handle response
    logger.debug(`Starting download from Slack: ${urlObj.hostname}${urlObj.pathname}`);
    const req = protocol.request(options, (res) => {
      // Check for non-200 status codes
      if (res.statusCode !== 200) {
        res.resume(); // Drain response to free up memory
        const error = new Error(`Failed to download file: HTTP ${res.statusCode}`);
        logger.warn(`HTTP error downloading file: ${res.statusCode} for ${s3Key}`);
        reject(error);
        return;
      }

      logger.debug(`HTTP response received: ${res.statusCode}, starting S3 upload for ${s3Key}`);

      // Handle HTTP response stream errors
      res.on('error', (err: Error) => {
        if (!uploadCompleted) {
          passThrough.destroy();
          logger.error(`HTTP stream error for ${s3Key}`, err);
          reject(new Error(`HTTP stream error: ${err.message}`));
        }
      });

      // Handle premature stream close
      res.on('close', () => {
        if (!uploadCompleted && !passThrough.destroyed) {
          logger.warn(`HTTP stream closed prematurely for ${s3Key}`);
          passThrough.end();
        }
      });

      // Pipe HTTP response to PassThrough stream
      // This intermediate stream allows better error handling
      res.pipe(passThrough);

      // Stream to S3 using PassThrough stream
      // This allows proper error handling and prevents non-retryable errors
      const uploadParams = {
        Bucket: bucketName,
        Key: s3Key,
        Body: passThrough,
        ContentType: contentType || res.headers['content-type'] || 'application/octet-stream',
      };

      uploadStarted = true;

      // Upload stream to S3
      s3Client.send(new s3Module.PutObjectCommand(uploadParams))
        .then(() => {
          uploadCompleted = true;
          logger.info(`Successfully uploaded ${s3Key} to S3`);
          resolve();
        })
        .catch((err: any) => {
          uploadCompleted = true;
          if (!passThrough.destroyed) {
            passThrough.destroy();
          }
          logger.error(`S3 upload failed for ${s3Key}`, err);
          reject(new Error(`Failed to upload to S3: ${err.message}`));
        });
    });

    // Handle request errors (network issues, connection failures)
    req.on('error', (err: Error) => {
      if (!uploadStarted) {
        logger.error(`HTTP request error before upload started for ${s3Key}`, err);
        reject(new Error(`Failed to download from Slack: ${err.message}`));
      } else if (!passThrough.destroyed) {
        passThrough.destroy();
        logger.error(`HTTP request error after upload started for ${s3Key}`, err);
        reject(new Error(`Request error after upload started: ${err.message}`));
      }
    });

    // Handle request timeout
    req.on('timeout', () => {
      req.destroy();
      logger.warn(`Request timeout for ${s3Key}`);
      if (!uploadStarted) {
        reject(new Error('Request timeout'));
      } else if (!passThrough.destroyed) {
        passThrough.destroy();
        reject(new Error('Request timeout after upload started'));
      }
    });

    // Send the request
    req.end();
  });
}

/**
 * Retry with exponential backoff
 * 
 * Implements exponential backoff retry strategy: delays between attempts
 * increase exponentially (1s, 2s, 4s) to avoid overwhelming downstream services
 * during transient failures. Useful for network calls that may fail temporarily.
 * 
 * @param fn - Function to retry (must return a Promise)
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @param baseDelayMs - Base delay in milliseconds (default: 1000ms = 1s)
 * @returns Result of successful function call
 * @throws Last error if all attempts fail
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
      // Don't retry if this was the last attempt
      if (attempt === maxAttempts) {
        break;
      }
      
      // Calculate exponential backoff delay: baseDelay * 2^(attempt-1)
      // Attempt 1: 1000ms (1s)
      // Attempt 2: 2000ms (2s)
      // Attempt 3: 4000ms (4s)
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms...`, lastError);
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
  s3Client: any
): Promise<string> {
  if (!file.url_private) {
    throw new Error(`File ${file.id} has no url_private - external file, skipping`);
  }

  const s3Key = `slack/${teamId}/${channelId}/${ts}/${file.id}`;

  logger.info(`Processing file: ${file.id} (${file.name || 'unnamed'}) -> ${s3Key}`);

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
 * 
 * Downloads all files from Slack and uploads to S3. Handles partial failures
 * gracefully - if one file fails, others continue processing. Returns both
 * successful downloads and failures for separate handling.
 * 
 * @param item - Message item with files array
 * @param oauthConfig - OAuth configuration for token retrieval
 * @param bucketName - S3 bucket name
 * @param s3Client - S3 client instance
 * @param clientId - OAuth client ID for token refresh
 * @param clientSecret - OAuth client secret for token refresh
 * @returns Object with successful S3 keys and failed file details
 */
export async function processMessageFiles(
  item: any,
  oauthConfig: OAuthConfig,
  bucketName: string,
  s3Client: any,
  clientId: string,
  clientSecret: string
): Promise<{ s3Keys: string[]; failedFiles: Array<{ file: any; error: Error }> }> {
  // Get valid bot token (auto-refreshes if needed)
  // Token is cached per team_id, so multiple files in same message reuse token
  const botToken = await getValidBotToken(
    oauthConfig.tableName,
    item.team_id,
    clientId,
    clientSecret
  );

  // Track successes and failures separately
  // Allows partial success - some files succeed while others fail
  const s3Keys: string[] = [];
  const failedFiles: Array<{ file: any; error: Error }> = [];
  
  // Process each file independently
  // Failures in one file don't block processing of others
  for (const file of item.files) {
    try {
      // Process single file with retry logic (3 attempts with exponential backoff)
      // Returns S3 key if successful, throws error if all retries fail
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
      // File processing failed after all retries - log and track for later
      // Don't throw - continue processing remaining files
      logger.error(`Failed to process file ${file.id} after retries`, fileError);
      failedFiles.push({ file, error: fileError as Error });
    }
  }

  // Return both successes and failures for separate DynamoDB updates
  // Successes: append to files_s3 array
  // Failures: mark in files_fetch_failed and files_fetch_error fields
  return { s3Keys, failedFiles };
}

