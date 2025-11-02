# Message Listener Lambda

Receives Slack Events API webhooks, validates signatures, routes events to handlers, writes to DynamoDB.

**Implementation:** [`../../functions/message-listener/src/index.ts`](../../functions/message-listener/src/index.ts)

## Specification

- **Runtime:** Node.js 22, ARM64
- **Memory:** 256 MB
- **Timeout:** 30 seconds
- **Trigger:** Lambda Function URL (public)
- **Response Time:** < 3 seconds

## Environment Variables

- `SLACK_ARCHIVE_TABLE` - DynamoDB table name
- `SLACK_SIGNING_SECRET_ARN` - Secrets Manager ARN for signing secret

## Request Flow

1. Parse request body (handle base64 encoding)
2. URL verification: if `type === "url_verification"`, return challenge
3. Verify Slack signature using `X-Slack-Signature` and `X-Slack-Request-Timestamp`
4. Parse event and route to handler
5. Write to DynamoDB
6. Return `200 OK` or error response

## Event Handlers

**Message Events:**
- `message` - New message → `PutItem`
- `message_changed` - Edit → `UpdateItem`
- `message_deleted` - Deletion → `UpdateItem` with `deleted = true`

**Channel Events:**
- `channel_created` - New channel → `PutItem`
- `channel_rename` - Name change → `UpdateItem` with `names_history`
- `channel_deleted` - Deletion → `UpdateItem` with `deleted = true`
- `channel_archive` / `channel_unarchive` - Archive status
- `channel_id_changed` - ID change → New `PutItem` with `prev_channel_id`
- `channel_purpose` / `channel_topic` - Purpose/topic update
- `channel_convert_to_private` / `channel_convert_to_public` - Visibility change

See [Data Model](../requirements/requirements.md) for DynamoDB schema.

## Permissions

- DynamoDB: `PutItem`, `UpdateItem`, `Query` on SlackArchive table
- Secrets Manager: `GetSecretValue` for signing secret
- CloudWatch Logs: Write permissions

## Related

- [API Endpoints](../api/endpoints.md)
- [Infrastructure Architecture](../infrastructure/architecture.md)

