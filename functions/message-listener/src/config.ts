import { TOKEN_DEFAULT_TTL, getSecretValue, getFromCache, hasInCache } from "mnemosyne-slack-shared";

interface Config {
  defaultCacheTtl: number;
  tableName: string;
  signingSecretArn: string;
  region: string;
}

/**
 * Load and validate configuration from environment variables
 */
export async function loadConfig(): Promise<Config> {
  if(hasInCache("config#loadConfig")) {
    const config = await getFromCache<Config>("config#loadConfig");
    if(config) {
      return config;
    }
  }
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable is required");
  }

  const signingSecretArn = process.env.SLACK_SIGNING_SECRET_ARN;
  if (!signingSecretArn) {
    throw new Error("SLACK_SIGNING_SECRET_ARN environment variable is required");
  }

  const region = process.env.AWS_REGION || "eu-west-1";

  return {
    defaultCacheTtl: TOKEN_DEFAULT_TTL,
    tableName,
    signingSecretArn,
    region,
  };
}

/**
 * Get signing secret from Secrets Manager (with caching)
 */
export async function getSigningSecret(config: Config): Promise<string> {
  try {
    return await getSecretValue(config.signingSecretArn, config.region);
  } catch (error) {
    throw new Error(
      `Failed to retrieve signing secret from Secrets Manager: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

