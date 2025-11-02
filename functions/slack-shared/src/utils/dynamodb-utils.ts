import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand, GetCommand, DeleteCommand ,} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { NodeHttpHandler } from "@aws-sdk/node-http-handler";
import * as http from "http";
import * as https from "https";
import { DYNAMU_MAX_KEY_LENGTH_BYTES} from "../config/settings";
import { getFromCache, hasInCache, setInCache } from "./cache";

// Create DynamoDB client and document client (singleton pattern with keep-alive)
// Global variables persist across warm Lambda invocations
let dynamoDbClient: DynamoDBClient | null = null;
let dynamoDb: DynamoDBDocumentClient | null = null;

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

function getDynamoDbClient(): DynamoDBClient {
  if (!dynamoDbClient) {
    dynamoDbClient = new DynamoDBClient({
      requestHandler: new NodeHttpHandler({
        httpAgent,
        httpsAgent,
        connectionTimeout: 2000,
        socketTimeout: 2000,
      }),
      // Keep connections alive between invocations
      maxAttempts: 3,
    });
  }
  return dynamoDbClient;
}

export function getDynamoDb(): DynamoDBDocumentClient {
  if (!dynamoDb) {
    dynamoDb = DynamoDBDocumentClient.from(getDynamoDbClient());
  }
  return dynamoDb;
}

// Export commands for use in other modules
export { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand };

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
  await getDynamoDb().send(
    new PutCommand({
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
  await getDynamoDb().send(
    new UpdateCommand({
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
  const result = await getDynamoDb().send(
    new QueryCommand({
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

  const result = await getDynamoDb().send(
    new GetCommand({
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
  await getDynamoDb().send(
    new DeleteCommand({
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