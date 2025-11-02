import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { NodeHttpHandler } from "@aws-sdk/node-http-handler";
import * as http from "http";
import * as https from "https";
import { getFromCache, setInCache } from "./cache";
import { SECRET_CACHE_PREFIX } from "../config/settings";

// Secrets Manager client (singleton pattern with keep-alive)
// Global variables persist across warm Lambda invocations
let secretsClient: SecretsManagerClient | null = null;

// HTTP agent with keep-alive for connection reuse
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 50,
  maxFreeSockets: 10,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30 seconds
  maxSockets: 50,
  maxFreeSockets: 10,
});

/**
 * Get or create Secrets Manager client
 */
export function getSecretsClient(region: string): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({
      region,
      requestHandler: new NodeHttpHandler({
        httpAgent,
        httpsAgent,
        connectionTimeout: 2000,
        socketTimeout: 2000,
      }),
      maxAttempts: 3,
    });
  }
  return secretsClient;
}


/**
 * Get secret value from Secrets Manager (with caching)
 * Cache TTL: 1 hour (secrets rarely change)
 */
export async function getSecretValue(
  secretArn: string,
  region: string
): Promise<string> {
  const cacheKey = `${SECRET_CACHE_PREFIX}${secretArn}`;
  
  // Check cache first
  const cached = await getFromCache<string>(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from Secrets Manager
  const client = getSecretsClient(region);
  const command = new GetSecretValueCommand({
    SecretId: secretArn,
  });
  const response = await client.send(command);

  const secretString = response.SecretString;
  if (!secretString) {
    throw new Error(`Secret not found in Secrets Manager: ${secretArn}`);
  }

  // Cache for 1 hour (3600 seconds)
  setInCache(cacheKey, secretString, 3600);

  return secretString;
}

