# File Processor Lambda

Processes DynamoDB stream records. Downloads Slack files and stores in S3.

**Implementation:** [`../../functions/file-processor/src/index.ts`](../../functions/file-processor/src/index.ts)

## Specification

- **Runtime:** Node.js 22, ARM64
- **Memory:** 512 MB
- **Timeout:** 15 minutes
- **Trigger:** DynamoDB Stream (INSERT, MODIFY on message items with files)
- **Concurrency:** 10 (for rate limiting Slack API calls)

## Environment Variables

- `SLACK_ARCHIVE_TABLE` - DynamoDB table name
- `SLACK_FILES_BUCKET` - S3 bucket name
- `SLACK_CLIENT_ID_ARN` - Secrets Manager ARN for OAuth client ID (for token refresh)
- `SLACK_CLIENT_SECRET_ARN` - Secrets Manager ARN for OAuth client secret (for token refresh)

**Bot Token:** Retrieved from DynamoDB using `getValidBotToken()` from `mnemosyne-slack-shared`. Automatically refreshes token if expired or expiring within 24 hours.

## Process Flow

1. Receive DynamoDB stream event
2. Filter records: messages with `files` attribute
3. For each file:
   - Get valid bot token (auto-refreshes if expired)
   - Download from Slack using `url_private` and bot token
   - Upload to S3 (`team_id/channel_id/file_id`)
   - Update DynamoDB item with S3 URI in `files_s3` array
4. Retry on failures with exponential backoff
5. Mark failed items with `files_fetch_failed = true`

## Permissions

- DynamoDB: `GetItem`, `PutItem`, `UpdateItem`, `Query` on SlackArchive table
- S3: `PutObject` on files bucket
- Secrets Manager: `GetSecretValue` for client ID and secret (for token refresh)
- Network: Outbound HTTPS to slack.com and S3

## Related

- [Infrastructure Architecture](../infrastructure/architecture.md)

