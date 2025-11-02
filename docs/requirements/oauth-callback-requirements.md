# OAuth Callback Lambda — Requirements

**Function:** Handle Slack OAuth flow, exchange code for tokens, store in DynamoDB.

---

## Technical Specifications

- **Runtime:** Node.js 22, ARM64
- **Memory:** 256 MB
- **Timeout:** 10 seconds
- **Trigger:** Lambda Function URL (public, no auth)

**Environment Variables:**
- `SLACK_ARCHIVE_TABLE` - DynamoDB table name
- `SLACK_CLIENT_ID_ARN` - Secrets Manager ARN for client ID
- `SLACK_CLIENT_SECRET_ARN` - Secrets Manager ARN for client secret

---

## Request Flow

1. **Validate incoming request**
   - Query params: `code`, `state`
   - Missing params → `400 Bad Request`

2. **Exchange code for tokens**
   - POST `https://slack.com/api/oauth.v2.access`
   - Body: `code`, `client_id`, `client_secret`, `redirect_uri`
   - Invalid code → `401 Unauthorized`

3. **Store tokens in DynamoDB**
   - Write item:
     ```
     itemId = "oauth#{team_id}"
     timestamp = "1"
     ```
   - Attributes: `bot_token`, `refresh_token`, `expires_at`, `scope`, `bot_user_id`, `team_id`, `team_name`
   - Overwrite existing (upsert)

4. **Response**
   - Success → `200 OK` with HTML: "Installation complete. Return to Slack."
   - Error → `500 Internal Server Error`

---

## DynamoDB Item Structure

```json
{
  "itemId": "oauth#T12345",
  "timestamp": "1",
  "bot_token": "xoxb-...",
  "refresh_token": "xoxe-...",
  "expires_at": 1699999999,
  "scope": "channels:history,channels:read,files:read,...",
  "bot_user_id": "U12345",
  "team_id": "T12345",
  "team_name": "Aristotle"
}
```

**Key pattern:** Always use `timestamp = "1"` to maintain single active token per team.

---

## Token Rotation (Optional)

If `token_rotation_enabled: true` in Slack app:
- Tokens expire (check `expires_at`)
- Refresh via `https://slack.com/api/oauth.v2.access` with `grant_type=refresh_token`, `refresh_token`
- Update DynamoDB item with new tokens

**Scheduled refresh:** EventBridge rule → Lambda checks `expires_at`, refreshes 24h before expiry.

---

## Error Handling

| Scenario | Response | Action |
|----------|----------|--------|
| Missing code/state | `400 Bad Request` | Log params |
| Invalid code | `401 Unauthorized` | Log Slack API error |
| DynamoDB write error | `500 Internal Server Error` | Log error, retry |
| Secrets Manager read error | `500 Internal Server Error` | Log error |

---

## Permissions

- DynamoDB: `PutItem` on SlackArchive table
- Secrets Manager: `GetSecretValue` for client ID and secret
- Network: Outbound HTTPS to slack.com

---

## Deployment

- Lambda Function URL added to Slack app manifest `redirect_urls`
- Client ID and secret stored in Secrets Manager (created in BaseRolesStack)

---

End.
