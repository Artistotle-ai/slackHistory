import { putItem, OAuthTokenItem } from "mnemosyne-slack-shared";

/**
 * Store OAuth tokens in DynamoDB
 */
export async function storeOAuthTokens(
  tableName: string,
  tokens: OAuthTokenItem
): Promise<void> {
  await putItem(tableName, tokens);
}

