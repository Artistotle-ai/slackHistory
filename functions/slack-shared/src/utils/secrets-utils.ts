// Lazy load AWS SDK and Node.js modules for better cold start performance
// These heavy dependencies are only loaded when Secrets Manager operations are actually needed
let secretsManagerModule: typeof import("@aws-sdk/client-secrets-manager") | null = null;
let nodeHttpHandlerModule: typeof import("@aws-sdk/node-http-handler") | null = null;
let httpModule: typeof import("http") | null = null;
let httpsModule: typeof import("https") | null = null;

import { getFromCache, setInCache } from "./cache";
import { SECRET_CACHE_PREFIX, SECRET_CACHE_TTL } from "../config/settings";

// Secrets Manager client (singleton pattern with keep-alive)
// Global variables persist across warm Lambda invocations
let secretsClient: any = null;

// HTTP agents with keep-alive (lazy loaded)
let httpAgent: any = null;
let httpsAgent: any = null;

/**
 * Lazy load HTTP agent (only when needed)
 */
function getHttpAgent(): any {
  if (!httpAgent) {
    if (!httpModule) {
      httpModule = require("http") as typeof import("http");
    }
    httpAgent = new httpModule.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000, // 30 seconds
      maxSockets: 50,
      maxFreeSockets: 10,
    });
  }
  return httpAgent;
}

/**
 * Lazy load HTTPS agent (only when needed)
 */
function getHttpsAgent(): any {
  if (!httpsAgent) {
    if (!httpsModule) {
      httpsModule = require("https") as typeof import("https");
    }
    httpsAgent = new httpsModule.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000, // 30 seconds
      maxSockets: 50,
      maxFreeSockets: 10,
    });
  }
  return httpsAgent;
}

/**
 * Get or create Secrets Manager client (lazy loaded)
 */
export async function getSecretsClient(region: string): Promise<any> {
  if (!secretsClient) {
    // Dynamically import AWS SDK modules (heavy dependencies)
    if (!secretsManagerModule) {
      secretsManagerModule = await import("@aws-sdk/client-secrets-manager");
    }
    if (!nodeHttpHandlerModule) {
      nodeHttpHandlerModule = await import("@aws-sdk/node-http-handler");
    }

    secretsClient = new secretsManagerModule.SecretsManagerClient({
      region,
      requestHandler: new nodeHttpHandlerModule.NodeHttpHandler({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
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
 * Cache TTL: 1 hour (secrets rarely change) - configured via SECRET_CACHE_TTL
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

  // Fetch from Secrets Manager (lazy load client)
  const client = await getSecretsClient(region);
  const command = new secretsManagerModule!.GetSecretValueCommand({
    SecretId: secretArn,
  });
  const response = await client.send(command);

  const secretString = response.SecretString;
  if (!secretString) {
    throw new Error(`Secret not found in Secrets Manager: ${secretArn}`);
  }

  // Cache with configured TTL
  setInCache(cacheKey, secretString, SECRET_CACHE_TTL);

  return secretString;
}

