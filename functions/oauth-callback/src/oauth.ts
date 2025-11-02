import { OAuthTokenItem } from "mnemosyne-slack-shared";

export interface SlackOAuthResponse {
  ok: boolean;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: {
    id: string;
    name: string;
  };
  authed_user?: {
    id: string;
  };
  error?: string;
  refresh_token?: string;
  expires_in?: number;
  tokenTTL?: number;
}

/**
 * Exchange OAuth code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<SlackOAuthResponse> {
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack OAuth API returned status ${response.status}`);
  }

  const data = await response.json() as SlackOAuthResponse;

  if (!data.ok) {
    throw new Error(`Slack OAuth error: ${data.error || "Unknown error"}`);
  }

  return data;
}

/**
 * Create OAuth token item for DynamoDB storage
 */
export function createOAuthTokenItem(
  oauthResponse: SlackOAuthResponse
): OAuthTokenItem {
  if (!oauthResponse.access_token) {
    throw new Error("Missing access_token in OAuth response");
  }

  if (!oauthResponse.team?.id) {
    throw new Error("Missing team.id in OAuth response");
  }

  const expiresAt = oauthResponse.expires_in
    ? Math.floor(Date.now() / 1000) + oauthResponse.expires_in
    : Infinity;

  return {
    itemId: `oauth#${oauthResponse.team.id}`,
    timestamp: "1", // Always "1" to maintain single active token per team
    bot_token: oauthResponse.access_token,
    refresh_token: oauthResponse.refresh_token,
    expires_at: expiresAt,
    scope: oauthResponse.scope,
    bot_user_id: oauthResponse.bot_user_id,
    team_id: oauthResponse.team.id,
    team_name: oauthResponse.team.name,
    ttlSeconds: oauthResponse.expires_in ? oauthResponse.expires_in : Infinity,  // set TTL to Infinity if expiresAt is not set
    isCachable: true,
    getTtlSeconds(): number | undefined {
      return this.ttlSeconds;
    },
  };
}

