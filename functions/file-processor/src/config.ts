import { loadOAuthConfig, OAuthConfig } from 'mnemosyne-slack-shared';

/**
 * Load configuration from environment variables
 */
export function loadConfig(): { oauthConfig: OAuthConfig; bucketName: string } {
  const oauthConfig = loadOAuthConfig();
  
  const bucketName = process.env.SLACK_FILES_BUCKET;
  if (!bucketName) {
    throw new Error('SLACK_FILES_BUCKET environment variable is required');
  }

  return { oauthConfig, bucketName };
}

