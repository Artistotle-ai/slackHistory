# Token Refresh

Handles Slack OAuth token refresh when token rotation is enabled.

**Status:** Implemented (token rotation enabled)

## When Token Refresh is Needed

If `token_rotation_enabled: true` in Slack app manifest:
- Bot tokens expire (check `expires_at` field in DynamoDB)
- Refresh tokens can be used to obtain new access tokens
- Refresh should occur before expiry (e.g., 24 hours before)

## Implementation

Token refresh is implemented as on-demand refresh:
- Functions check token expiry before API calls
- Uses `getValidBotToken()` from `mnemosyne-slack-shared`
- Automatically refreshes tokens expiring within 24 hours
- Updates DynamoDB with new tokens atomically

**Shared Function:** `slack-shared/src/token-refresh.ts`

## Token Refresh Flow

1. Retrieve OAuth token from DynamoDB (`itemId = "oauth#{team_id}"`)
2. Check `expires_at` field
3. If expired or expiring soon:
   - POST to `https://slack.com/api/oauth.v2.access`
   - Body: `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`
4. Update DynamoDB with new `bot_token`, `refresh_token`, `expires_at`
5. Return new token

## Related

- [OAuth Callback](./oauth-callback.md) - Initial token storage
- [File Processor](./file-processor.md) - Uses bot token for API calls

