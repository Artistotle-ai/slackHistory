// Re-export DynamoDB utilities from shared package
export {
  putItem,
  updateItem,
  queryItems,
  getLatestItem,
  type DynamoDBKey,
  type QueryOptions,
} from "mnemosyne-slack-shared";
