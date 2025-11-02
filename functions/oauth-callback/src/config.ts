import { getSecretValue, getFromCache, setInCache, formatErrorMessage, SECRET_CACHE_TTL } from "mnemosyne-slack-shared";

interface Config {
  tableName: string;
  clientIdArn: string;
  clientSecretArn: string;
  region: string;
}

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

// Cache key for OAuth credentials
const OAUTH_CREDENTIALS_CACHE_KEY = "oauth_credentials";

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  const tableName = process.env.SLACK_ARCHIVE_TABLE;
  if (!tableName) {
    throw new Error("SLACK_ARCHIVE_TABLE environment variable is required");
  }

  const clientIdArn = process.env.SLACK_CLIENT_ID_ARN;
  if (!clientIdArn) {
    throw new Error("SLACK_CLIENT_ID_ARN environment variable is required");
  }

  const clientSecretArn = process.env.SLACK_CLIENT_SECRET_ARN;
  if (!clientSecretArn) {
    throw new Error("SLACK_CLIENT_SECRET_ARN environment variable is required");
  }

  const region = process.env.AWS_REGION || "eu-west-1";

  return {
    tableName,
    clientIdArn,
    clientSecretArn,
    region,
  };
}

/**
 * Get OAuth credentials from Secrets Manager (with caching)
 */
export async function getOAuthCredentials(config: Config): Promise<OAuthCredentials> {
  // Check cache first
  const cached = getFromCache<OAuthCredentials>(OAUTH_CREDENTIALS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  try {
    // Fetch both secrets in parallel (with caching)
    const [clientId, clientSecret] = await Promise.all([
      getSecretValue(config.clientIdArn, config.region),
      getSecretValue(config.clientSecretArn, config.region),
    ]);

    if (!clientId) {
      throw new Error(
        `Client ID not found in Secrets Manager: ${config.clientIdArn}`
      );
    }

    if (!clientSecret) {
      throw new Error(
        `Client secret not found in Secrets Manager: ${config.clientSecretArn}`
      );
    }

    const credentials: OAuthCredentials = {
      clientId,
      clientSecret,
    };

    // Cache credentials with configured TTL (same as secrets)
    setInCache(OAUTH_CREDENTIALS_CACHE_KEY, credentials, SECRET_CACHE_TTL);

    return credentials;
  } catch (error) {
    throw new Error(
      `Failed to retrieve OAuth credentials from Secrets Manager: ${formatErrorMessage(error)}`
    );
  }
}

