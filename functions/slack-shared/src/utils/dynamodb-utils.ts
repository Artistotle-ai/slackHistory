// Lazy load AWS SDK and Node.js modules for better cold start performance
// These heavy dependencies are only loaded when DynamoDB operations are actually needed
let dynamoDbClientModule: typeof import("@aws-sdk/client-dynamodb") | null = null;
let dynamoDbDocModule: typeof import("@aws-sdk/lib-dynamodb") | null = null;
let nodeHttpHandlerModule: typeof import("@aws-sdk/node-http-handler") | null = null;
let httpModule: typeof import("http") | null = null;
let httpsModule: typeof import("https") | null = null;

import { DYNAMU_MAX_KEY_LENGTH_BYTES} from "../config/settings";
import { getFromCache, hasInCache, setInCache } from "./cache";

// Create DynamoDB client and document client (singleton pattern with keep-alive)
// Global variables persist across warm Lambda invocations
let dynamoDbClient: any = null;
let dynamoDb: any = null;

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
 * Lazy load DynamoDB client (AWS SDK is heavy, only load when needed)
 */
async function getDynamoDbClient(): Promise<any> {
  if (!dynamoDbClient) {
    // Dynamically import AWS SDK modules (heavy dependencies)
    if (!dynamoDbClientModule) {
      dynamoDbClientModule = await import("@aws-sdk/client-dynamodb");
    }
    if (!nodeHttpHandlerModule) {
      nodeHttpHandlerModule = await import("@aws-sdk/node-http-handler");
    }

    dynamoDbClient = new dynamoDbClientModule.DynamoDBClient({
      requestHandler: new nodeHttpHandlerModule.NodeHttpHandler({
        httpAgent: getHttpAgent(),
        httpsAgent: getHttpsAgent(),
        connectionTimeout: 2000,
        socketTimeout: 2000,
      }),
      // Keep connections alive between invocations
      maxAttempts: 3,
    });
  }
  return dynamoDbClient;
}

/**
 * Lazy load DynamoDB Document Client (wraps DynamoDB client with convenience methods)
 */
export async function getDynamoDb(): Promise<any> {
  if (!dynamoDb) {
    if (!dynamoDbDocModule) {
      dynamoDbDocModule = await import("@aws-sdk/lib-dynamodb");
    }
    const client = await getDynamoDbClient();
    dynamoDb = dynamoDbDocModule.DynamoDBDocumentClient.from(client);
  }
  return dynamoDb;
}

// Export command constructors (lightweight, can be imported statically)
// These are just class constructors, not the heavy client code
export async function getCommands() {
  if (!dynamoDbDocModule) {
    dynamoDbDocModule = await import("@aws-sdk/lib-dynamodb");
  }
  return {
    GetCommand: dynamoDbDocModule.GetCommand,
    PutCommand: dynamoDbDocModule.PutCommand,
    UpdateCommand: dynamoDbDocModule.UpdateCommand,
    DeleteCommand: dynamoDbDocModule.DeleteCommand,
    QueryCommand: dynamoDbDocModule.QueryCommand,
  };
}

export interface DynamoDBKey {
  itemId: string;
  timestamp: string;
}

export interface QueryOptions {
  tableName: string;
  itemId: string;
  limit?: number;
  scanIndexForward?: boolean;
}

/**
 * Put an item into DynamoDB
 */
export async function putItem<T extends Record<string, unknown>>(
  tableName: string,
  item: T
): Promise<void> {
  const db = await getDynamoDb();
  const commands = await getCommands();
  await db.send(
    new commands.PutCommand({
      TableName: tableName,
      Item: item,
    })
  );
}

/**
 * Update an item in DynamoDB
 */
export async function updateItem(
  tableName: string,
  key: DynamoDBKey,
  updateExpression: string,
  expressionAttributeValues: Record<string, unknown>
): Promise<void> {
  const db = await getDynamoDb();
  const commands = await getCommands();
  await db.send(
    new commands.UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

/**
 * Query items by itemId
 */
export async function queryItems<T extends Record<string, unknown>>(
  options: QueryOptions
): Promise<T[]> {
  const db = await getDynamoDb();
  const commands = await getCommands();
  const result = await db.send(
    new commands.QueryCommand({
      TableName: options.tableName,
      KeyConditionExpression: "itemId = :itemId",
      ExpressionAttributeValues: {
        ":itemId": options.itemId,
      },
      ScanIndexForward: options.scanIndexForward ?? true,
      Limit: options.limit,
    })
  );

  return (result.Items as T[]) || [];
}

/**
 * Get the latest item by itemId (highest timestamp)
 */
export async function getLatestItem<T extends Record<string, unknown>>(
  tableName: string,
  itemId: string
): Promise<T | null> {
  const cacheKey = `${tableName}#${itemId}`;
  const cached = await getFromCache<T>(cacheKey);
  if (cached) {
    return cached;
  }
  const items = await queryItems<T>({
    tableName,
    itemId,
    limit: 1,
    scanIndexForward: false,
  });

  if (items.length > 0) {
    await setInCache(cacheKey, items[0]);
  }

  return items[0] || null;
}
export async function dynamoGetById<T extends Record<string, unknown>>(
  tableName: string,
  itemId: string,
  sortKey?: string
): Promise<T | null> {
  const key: Record<string, unknown> = {
    itemId: dynamoSanitizeKey(itemId),
  }
  if (sortKey !== undefined) {
    key.timestamp = dynamoSanitizeKey(sortKey);
  }

  const db = await getDynamoDb();
  const commands = await getCommands();
  const result = await db.send(
    new commands.GetCommand({
      TableName: tableName,
      Key: key,
    })
  );

  if (!result.Item) {
    return null;
  }
  return result.Item as T;
}

export async function dynamoDeleteItem(
  tableName: string,
  key: DynamoDBKey
): Promise<void> {
  const db = await getDynamoDb();
  const commands = await getCommands();
  await db.send(
    new commands.DeleteCommand({
      TableName: tableName,
      Key: key,
    })
  );
}
function dynamoSanitizeKey(key: string): string {
  const bytes = Buffer.byteLength(key, 'utf8');
  if (bytes > DYNAMU_MAX_KEY_LENGTH_BYTES) {
    // Truncate to fit within byte limit, accounting for multibyte characters
    let truncated = key;
    while (Buffer.byteLength(truncated, 'utf8') > DYNAMU_MAX_KEY_LENGTH_BYTES) {
      truncated = truncated.slice(0, -1);
    }
    return truncated;
  }
  return key;
}

/**
 * Create a DynamoDB wrapper with convenient methods
 */
export function createDynamoClient(tableName: string) {
  return {
    /**
     * Get an item by itemId and optional sortKey
     * @param itemId - The partition key (itemId)
     * @param sortKey - Optional sort key (timestamp)
     * @returns The item or null if not found
     */
    get: async <T extends Record<string, unknown>>(
      itemId: string,
      sortKey?: string
    ): Promise<T | null> => {
      return dynamoGetById<T>(tableName, itemId, sortKey);
    },
  };
}