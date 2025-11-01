import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

interface Config {
  tableName: string;
  signingSecretArn: string;
  botTokenArn: string | null;
  region: string;
}

interface Secrets {
  signingSecret: string;
  botToken: string | null;
}

// Cache for secrets (in-memory cache for Lambda invocations)
let secretsCache: Secrets | null = null;

// Secrets Manager client instance
let secretsClient: SecretsManagerClient | null = null;

/**
 * Get or create Secrets Manager client
 */
function getSecretsClient(region: string): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({ region });
  }
  return secretsClient;
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable is required");
  }

  const signingSecretArn = process.env.SLACK_SIGNING_SECRET_ARN;
  if (!signingSecretArn) {
    throw new Error("SLACK_SIGNING_SECRET_ARN environment variable is required");
  }

  const botTokenArn = process.env.SLACK_BOT_TOKEN_ARN || null;

  const region = process.env.AWS_REGION || "eu-west-1";

  return {
    tableName,
    signingSecretArn,
    botTokenArn,
    region,
  };
}

/**
 * Get signing secret from Secrets Manager (with caching)
 */
export async function getSigningSecret(config: Config): Promise<string> {
  if (secretsCache?.signingSecret) {
    return secretsCache.signingSecret;
  }

  const client = getSecretsClient(config.region);

  try {
    const command = new GetSecretValueCommand({
      SecretId: config.signingSecretArn,
    });
    const response = await client.send(command);

    const secretString = response.SecretString;
    if (!secretString) {
      throw new Error(
        `Signing secret not found in Secrets Manager: ${config.signingSecretArn}`
      );
    }

    if (!secretsCache) {
      secretsCache = { signingSecret: secretString, botToken: null };
    } else {
      secretsCache.signingSecret = secretString;
    }

    return secretString;
  } catch (error) {
    throw new Error(
      `Failed to retrieve signing secret from Secrets Manager: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get bot token from Secrets Manager (with caching, optional)
 */
export async function getBotToken(config: Config): Promise<string | null> {
  if (!config.botTokenArn) {
    return null;
  }

  if (secretsCache?.botToken) {
    return secretsCache.botToken;
  }

  const client = getSecretsClient(config.region);

  try {
    const command = new GetSecretValueCommand({
      SecretId: config.botTokenArn,
    });
    const response = await client.send(command);

    const botToken = response.SecretString || null;

    if (!secretsCache) {
      secretsCache = { signingSecret: "", botToken };
    } else {
      secretsCache.botToken = botToken;
    }

    return botToken;
  } catch (error) {
    console.warn(
      `Bot token not available: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
