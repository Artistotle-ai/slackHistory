# OAuth Callback Lambda

Handles Slack OAuth installation flow. Exchanges authorization code for bot token, stores in DynamoDB.

**Implementation:** [`../../functions/oauth-callback/src/index.ts`](../../functions/oauth-callback/src/index.ts)

## Specification

- **Runtime:** Node.js 22, ARM64
- **Memory:** 256 MB
- **Timeout:** 10 seconds
- **Trigger:** Lambda Function URL (public)
- **Endpoint:** GET with query parameters

## Environment Variables

- `SLACK_ARCHIVE_TABLE` - DynamoDB table name
- `SLACK_CLIENT_ID_ARN` - Secrets Manager ARN for OAuth client ID
- `SLACK_CLIENT_SECRET_ARN` - Secrets Manager ARN for OAuth client secret
- `REDIRECT_URI` - OAuth redirect URI (Function URL)

## Request Flow

1. Validate query parameters (`code`, `state`)
2. Retrieve OAuth credentials from Secrets Manager
3. Exchange code for tokens via `https://slack.com/api/oauth.v2.access`
4. Store tokens in DynamoDB (`itemId = "oauth#{team_id}", timestamp = "1"`)
5. Return HTML success page

## DynamoDB Storage

**Item:**
```
itemId: "oauth#{team_id}"
timestamp: "1"
bot_token: "xoxb-..."
refresh_token: "xoxe-..." (optional)
expires_at: 1699999999 (optional)
scope: "channels:history,channels:read,..."
bot_user_id: "U12345"
team_id: "T12345"
team_name: "Workspace Name"
```

## Permissions

- DynamoDB: `PutItem` on SlackArchive table
- Secrets Manager: `GetSecretValue` for client ID and secret
- Network: Outbound HTTPS to slack.com

## Token Rotation

Token rotation is enabled (`token_rotation_enabled: true`):
- Tokens include `expires_at` and `refresh_token` fields
- Tokens must be refreshed before expiry
- Functions automatically refresh tokens using `getValidBotToken()` from `mnemosyne-slack-shared`
- See [Token Refresh](./token-refresh.md) for implementation details

## Related

- [API Endpoints](../api/endpoints.md)
- [Infrastructure Architecture](../infrastructure/architecture.md)
- [Token Refresh](./token-refresh.md) - Token refresh implementation (if rotation enabled)

