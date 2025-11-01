import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { MessageItem, ChannelItem } from "mnemosyne-slack-shared";

// Create DynamoDB client and document client
const dynamoDbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(dynamoDbClient);

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
export async function putItem<T extends MessageItem | ChannelItem>(
  tableName: string,
  item: T
): Promise<void> {
  await dynamoDb.send(
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
  await dynamoDb.send(
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
export async function queryItems<T = MessageItem | ChannelItem>(
  options: QueryOptions
): Promise<T[]> {
  const result = await dynamoDb.send(
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
export async function getLatestItem<T = MessageItem | ChannelItem>(
  tableName: string,
  itemId: string
): Promise<T | null> {
  const items = await queryItems<T>({
    tableName,
    itemId,
    limit: 1,
    scanIndexForward: false,
  });

  return items.length > 0 ? items[0] : null;
}
