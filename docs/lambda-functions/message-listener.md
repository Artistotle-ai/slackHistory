# Message Listener Lambda

Receives Slack Events API webhooks, validates signatures, routes events to handlers, writes to DynamoDB.

**Implementation:** [`../../functions/message-listener/src/index.ts`](../../functions/message-listener/src/index.ts)

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
- `message` - New message → `PutItem` with `itemId="message#{team_id}#{channel_id}", timestamp="{ts}"`
  - Stores: `text`, `user`, `thread_ts`, `files`, `raw_event`
  - Thread replies: Sets `parent="thread#{team_id}#{thread_ts}"`
  - Subtypes ignored: `channel_join`, `channel_leave`
  - File metadata: Whitelisted fields (id, name, mimetype, size, url_private, etc.)
- `message_changed` - Edit → `UpdateItem` (upsert) with `text`, `updated_ts`
- `message_deleted` - Deletion → `UpdateItem` with `deleted = true`

**Channel Events:**
- `channel_created` - New channel → `PutItem` with `itemId="channel#{team_id}#{channel_id}"`
- `channel_rename` - Name change → `UpdateItem` with `names_history` (max 20 entries)
- `channel_deleted` - Deletion → `UpdateItem` with `deleted = true`
- `channel_archive` - Archive → `UpdateItem` with `archived = true`
- `channel_unarchive` - Unarchive → `REMOVE archived` (no false booleans)
- `channel_id_changed` - ID change → New `PutItem` with `prev_channel_id`
- `channel_purpose` / `channel_topic` - Purpose/topic update → `UpdateItem`
- `channel_convert_to_private` / `channel_convert_to_public` - Visibility change

**Other Events:**
- `file_shared` - File upload notification (logged only; files captured via `message.files`)

See [Data Model](../requirements/requirements.md) for DynamoDB schema.

## Error Handling

- Invalid signature → `401 Unauthorized`
- Malformed JSON → `400 Bad Request`
- DynamoDB error → `500 Internal Server Error`
- Unknown event type → `200 OK` (logged, ignored)

## Permissions

- DynamoDB: `PutItem`, `UpdateItem`, `Query` on SlackArchive table
- Secrets Manager: `GetSecretValue` for signing secret
- CloudWatch Logs: Write permissions

## Data Storage

- No false booleans (omit `archived = false`, use `REMOVE`)
- `names_history` capped at 20 entries
- File metadata whitelist (excludes scaled image URLs)
- `raw_event` stored by default for debugging

## Related

- [API Endpoints](../api/endpoints.md)
- [Infrastructure Architecture](../infrastructure/architecture.md)
- [Data Schema](../requirements/requirements.md)

