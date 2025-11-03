# File Processor Lambda

Processes DynamoDB stream records. Downloads Slack files and stores in S3.

**Implementation:** [`../../functions/file-processor/src/index.ts`](../../functions/file-processor/src/index.ts)

## Specification

- **Runtime:** Node.js 20, ARM64
- **Memory:** 512 MB
- **Timeout:** 5 minutes
- **Trigger:** DynamoDB Stream (INSERT, MODIFY on message items with files)
- **Reserved Concurrency:** 1 (serializes ChannelIndex updates to prevent race conditions)

## Environment Variables

- `SLACK_ARCHIVE_TABLE` - DynamoDB table name
- `SLACK_FILES_BUCKET` - S3 bucket name
- `SLACK_CLIENT_ID_ARN` - Secrets Manager ARN for OAuth client ID (for token refresh)
- `SLACK_CLIENT_SECRET_ARN` - Secrets Manager ARN for OAuth client secret (for token refresh)

**Bot Token:** Retrieved from DynamoDB using `getValidBotToken()` from `mnemosyne-slack-shared`. Automatically refreshes token if expired or expiring within 24 hours.

## Process Flow

1. Receive DynamoDB stream event (INSERT/MODIFY on messages with files or channels)
2. Unmarshall stream records from DynamoDB format
3. Process channel items: Maintain ChannelIndex (channel_id → name mapping with sharding)
4. Process message items with files:
   - Filter records: messages with `files` attribute and no `files_s3` (or incomplete)
   - Get OAuth credentials from Secrets Manager (cached for warm starts)
   - For each file:
     - Get valid bot token (auto-refreshes if expired)
     - **Stream download** from Slack using `url_private` with Authorization header
     - **Stream upload** to S3 without loading into memory (handles large files)
     - Upload to S3 key: `slack/{team_id}/{channel_id}/{ts}/{file_id}`
     - Update DynamoDB item with S3 keys in `files_s3` array
   - Mark failed items with `files_fetch_failed = true` for retry

## Error Handling

- File download failure → Log error, continue with other files
- S3 upload failure → Log error, continue with other files
- DynamoDB update failure → Log error, mark `files_fetch_failed = true`
- External files (no `url_private`) → Skip, log warning
- ChannelIndex update failure → Log error, continue processing (non-critical)

## ChannelIndex Maintenance

**Sharding Strategy:**
- ChannelIndex shards created when item exceeds 350KB (DynamoDB limit is 400KB)
- Shard numbering: timestamp increments ('0', '1', '2', ...)
- Each shard contains `channels_map` (channel_id → name)
- Deleted channels prefixed with `deleted_` in index

**Race Condition Prevention:**
- Reserved concurrency = 1 ensures serial updates to ChannelIndex
- No concurrent shard creation possible

## Permissions

- DynamoDB: `GetItem`, `PutItem`, `UpdateItem`, `Query` on SlackArchive table
- S3: `PutObject` on files bucket
- Secrets Manager: `GetSecretValue` for client ID and secret (for token refresh)
- Network: Outbound HTTPS to slack.com and S3

## Related

- [Infrastructure Architecture](../infrastructure/architecture.md)
- [Token Refresh](./token-refresh.md) - Token refresh implementation

