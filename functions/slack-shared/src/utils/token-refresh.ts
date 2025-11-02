import { getDynamoDb, getCommands, dynamoDeleteItem, dynamoGetById } from "./dynamodb-utils";
import { getFromCache, setInCache, hasInCache, removeFromCache } from "./cache";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { OAuthTokenItem, RefreshTokenResponse } from "../config/types";
import { REFRESH_CACHE_PREFIX, TOKEN_CACHE_PREFIX, TOKEN_DEFAULT_TTL, TOKEN_REFRESH_BUFFER } from "../config/settings";
import { getTokenItemDbId, getTokenItemCacheKey } from "./utils";
import { logger } from "./logger";

// Cache keys



/**
 * Refresh OAuth token using refresh token
 */
export async function refreshOAuthToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<RefreshTokenResponse> {
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack OAuth API returned status ${response.status}`);
  }

  const data = await response.json() as RefreshTokenResponse;

  if (!data.ok) {
    throw new Error(`Slack OAuth refresh error: ${data.error || "Unknown error"}`);
  }

  return data;
}
const getCacheTTL = (ttl = TOKEN_DEFAULT_TTL): number => {
  return ttl ? ttl : TOKEN_DEFAULT_TTL; // if ttl is not set, return default ttl
}
export async function getFromCacheOrDbWithValidation(teamId: string, tableName: string): Promise<OAuthTokenItem | null> {
  // try to retrieve the item from memory and check if it is expired
  let cacheTokenItem = await getFromCache<OAuthTokenItem>(getTokenItemCacheKey(teamId, tableName));
  if(!cacheTokenItem) { 
    cacheTokenItem = await getTokenItemFromDbIfNotExpired(tableName, teamId);
    if(cacheTokenItem) {
      await setInCache(getTokenItemCacheKey(teamId, tableName), cacheTokenItem, getCacheTTL(cacheTokenItem.ttlSeconds));
    }
  }
  return cacheTokenItem;
}
/**
 * Get OAuth token from DynamoDB (with caching)
 */
export async function getOAuthToken(
  tableName: string,
  teamId: string
): Promise<OAuthTokenItem | null> {
  // Check cache first
  const cacheKey = getTokenItemCacheKey(teamId, tableName);
  const cached = await getFromCache<OAuthTokenItem>(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from DB
  const tokenItem = await getTokenItemFromDbIfNotExpired(tableName, teamId);

  if (!tokenItem) {
    return null;
  }

  // Cache for 60% of the TTL if ttlSeconds is set, otherwise set to TOKEN_DEFAULT_TTL
  if(tokenItem.ttlSeconds) {
    await setInCache(cacheKey, tokenItem, tokenItem.ttlSeconds * 0.6); // if ttlSeconds is infinity 0.6 * infinity = infinity
  } else {
    await setInCache(cacheKey, tokenItem, TOKEN_DEFAULT_TTL);
  }
  return tokenItem;
}

/**
 * Update OAuth token in DynamoDB (with cache invalidation)
 */
export async function updateOAuthToken(
  tableName: string,
  tokenItem: OAuthTokenItem
): Promise<void> {
  const db = await getDynamoDb();
  await db.send(
    new PutCommand({
      TableName: tableName,
      Item: tokenItem,
    })
  );

  // Update cache with new token
  const cacheKey = `${TOKEN_CACHE_PREFIX}${tableName}:${tokenItem.team_id}`;
  setInCache(cacheKey, tokenItem, TOKEN_DEFAULT_TTL); 
  
  // Mark as refreshed (prevent concurrent refreshes)
  const refreshCacheKey = `${REFRESH_CACHE_PREFIX}${tokenItem.team_id}`;
  setInCache(refreshCacheKey, true, 60); // 1 minute lock
}

/**
 * Check if token is expired or expiring soon
 */
export function isTokenExpired(
  tokenItem: OAuthTokenItem, 
  bufferSeconds: number = TOKEN_REFRESH_BUFFER
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = tokenItem.expires_at;
  
  // If expiresAt is Infinity or undefined, token never expires
  if (!expiresAt || !isFinite(expiresAt)) {
    return false;
  }
  
  // Check if token is expired or expiring soon
  const refreshThreshold = expiresAt - bufferSeconds; //refresh 1/3 of the interval before expiry
  return now >= refreshThreshold;
}
export async function getTokenItemFromDbIfNotExpired(tableName: string, teamId: string): Promise<OAuthTokenItem | null> {
  const tokenItem = await dynamoGetById<OAuthTokenItem>(tableName, getTokenItemDbId(teamId), "1");
  if (!tokenItem) {
    return null;
  }
  if (isTokenExpired(tokenItem)) {
    dynamoDeleteItem(tableName, {
      itemId: tokenItem.itemId,
      timestamp: tokenItem.timestamp,
    });
    return null;
  }
  return tokenItem;
}
export async function getTokenFromDb(
  tableName: string,
  itemId: string
): Promise<OAuthTokenItem | null> {
  const result = await getTokenItemFromDbIfNotExpired(tableName, itemId);
  if (!result) {
    return null;
  }
  return result;
}

export async function deleteToken(
  tableName: string,
  teamId: string
): Promise<void> {
  await dynamoDeleteItem(tableName, {
    itemId: `oauth#${teamId}`,
    timestamp: "1",
  });
}

/**
 * Get valid bot token, refreshing if necessary (with refresh deduplication)
 */
export async function getValidBotToken(
  tableName: string,
  teamId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  let tokenItem = await getOAuthToken(tableName, teamId);

  if (!tokenItem) {
    throw new Error(`No OAuth token found for team: ${teamId}`);
  }

  // Check if token needs refresh
  if (isTokenExpired(tokenItem)) {
    if (!tokenItem.refresh_token) {
      throw new Error(`Token expired and no refresh token available for team: ${teamId}`);
    }

    // Check if refresh is already in progress (prevent concurrent refreshes)
    const refreshCacheKey = `${REFRESH_CACHE_PREFIX}${teamId}`;
    if (hasInCache(refreshCacheKey)) {
      // Wait a bit and retry (another invocation is refreshing)
      await new Promise(resolve => setTimeout(resolve, 100));
      const retriedTokenItem = await getOAuthToken(tableName, teamId);
      if (retriedTokenItem && !isTokenExpired(retriedTokenItem)) {
        return retriedTokenItem.bot_token;
      }
      // If still expired, continue with refresh
      if (retriedTokenItem) {
        tokenItem = retriedTokenItem;
      }
    }

    logger.debug(`Refreshing expired token for team: ${teamId}`);

    // Mark refresh in progress
    setInCache(refreshCacheKey, true, 60); // 1 minute TTL

    try {
      // Refresh token
      const refreshResponse = await refreshOAuthToken(
        tokenItem.refresh_token!,
        clientId,
        clientSecret
      );

      if (!refreshResponse.access_token) {
        throw new Error("No access token in refresh response");
      }

      // Update token item, if no expiry is set, set to infinity (never expire)
      const expiresAt = refreshResponse.expires_in
        ? Math.floor(Date.now() / 1000) + refreshResponse.expires_in
        : Infinity;

      const updatedTokenItem: OAuthTokenItem = {
        itemId: tokenItem.itemId,
        timestamp: tokenItem.timestamp,
        bot_token: refreshResponse.access_token,
        refresh_token: refreshResponse.refresh_token || tokenItem.refresh_token,
        expires_at: expiresAt,
        scope: tokenItem.scope,
        bot_user_id: tokenItem.bot_user_id,
        team_id: tokenItem.team_id,
        team_name: tokenItem.team_name,
        ttlSeconds: expiresAt - Math.floor(Date.now() / 1000), //infinity - now = infinity
        isCachable: true,
        getTtlSeconds(): number | undefined {
          return this.ttlSeconds;
        },
      };

      // Save updated token
      await updateOAuthToken(tableName, updatedTokenItem);

      // Return new token
      tokenItem = updatedTokenItem;

      logger.debug(`Successfully refreshed token for team: ${teamId}`);
    } catch (error) {
      // Remove refresh lock on error
      setInCache(refreshCacheKey, false, 1); // Expire immediately
      throw error;
    }
  }

  return tokenItem.bot_token;
}

