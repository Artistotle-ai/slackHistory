# Message Listener Lambda — Requirements

**Function:** Receive Slack Events API webhooks, validate, and write to DynamoDB.

**Philosophy:** Store everything, optimize later. Accept data loss/duplication. Not mission-critical.

---



**Environment Variables:**
- `SLACK_ARCHIVE_TABLE` - DynamoDB table name ✅ IMPLEMENTED
- `SLACK_SIGNING_SECRET_ARN` - Secrets Manager ARN for signing secret ✅ IMPLEMENTED
- `SLACK_CLIENT_ID_ARN` - Secrets Manager ARN for OAuth client ID ✅ IMPLEMENTED
- `SLACK_CLIENT_SECRET_ARN` - Secrets Manager ARN for OAuth client secret ✅ IMPLEMENTED

---

## Request Flow

1. **URL Verification Challenge** (one-time Slack setup)
   - If `event.type === "url_verification"` → respond `200` with `{"challenge": event.challenge}`

2. **Signature Verification**
   - Validate `X-Slack-Signature` using signing secret and request timestamp
   - Invalid → `401 Unauthorized`

3. **Event Routing**
   - Parse `event.type` and `event.subtype`
   - Route to appropriate handler
   - Unknown event type → log, return `200`

4. **DynamoDB Write**
   - Execute handler logic (see Event Handlers below)
   - Success → `200 OK`
   - DynamoDB error → `500` (TODO: add DLQ for retries)
   - Malformed payload → `400 Bad Request`

**Response Time:** Must respond to Slack within 3 seconds.

---

## Event Handlers

### Message Events

**`message` (new message)**

DynamoDB: `PutItem`

```
itemId = "message#{team_id}#{channel_id}"
timestamp = "{ts}"
```

**Attributes:**
- `itemId`, `timestamp` (keys)
- `type` = "message"
- `team_id`, `channel_id`, `ts`, `text`, `user`
- `thread_ts` (if present)
- `parent` = "thread#{team_id}#{thread_ts}" (if thread_ts present)
- `files` (if present, see File Metadata Whitelist)
- `raw_event` (full Slack event payload)

**Thread Logic:**
- No `thread_ts` → omit `parent`
- `thread_ts === ts` → parent message, set `parent`
- `thread_ts !== ts` → thread reply, set `parent`

**Subtypes to IGNORE:**
- `channel_join`, `channel_leave`

**Subtypes to KEEP:**
- `bot_message`, `me_message`, `file_share`, `thread_broadcast`
- All other subtypes → store (evaluate later with real data)

---

**`message_changed` (edit)**

DynamoDB: `UpdateItem` (upsert semantics)

```
itemId = "message#{team_id}#{channel_id}"
timestamp = "{message.ts}"  # original message ts from event.message.ts
```

**Update Expression:**
```
SET text = :text,
    raw_event = :raw_event,
    updated_ts = :updated_ts
```

If item missing (rare), create with `updated_ts`.

---

**`message_deleted` (delete)**

DynamoDB: `UpdateItem`

```
itemId = "message#{team_id}#{channel_id}"
timestamp = "{deleted_ts}"  # from event payload
```

**Update Expression:**
```
SET deleted = :true
```

---

### Channel Events

**`channel_created`**

DynamoDB: `PutItem`

```
itemId = "channel#{team_id}#{channel_id}"
timestamp = "{event_ts}"
```

**Attributes:**
- `type` = "channel"
- `team_id`, `channel_id`, `name`
- `names_history` = [name] (initial array)
- `visibility` = "public" (default)
- `raw_event`

---

**`channel_rename`**

DynamoDB: `UpdateItem`

```
itemId = "channel#{team_id}#{channel_id}"
timestamp = "{event_ts}"  # query for latest timestamp first, or use deterministic value
```

**Update Expression:**
```
SET name = :new_name,
    names_history = list_append(:new_name_list, if_not_exists(names_history, :empty_list)),
    raw_event = :raw_event
```

Cap `names_history` at 20 entries (trim oldest if needed).

---

**`channel_deleted`**

DynamoDB: `UpdateItem`

```
SET deleted = :true
```

---

**`channel_archive`**

DynamoDB: `UpdateItem`

```
SET archived = :true
```

---

**`channel_unarchive`**

DynamoDB: `UpdateItem`

```
REMOVE archived
```

(Do NOT set `archived = false`, omit attribute to save space)

---

**`channel_id_changed`**

DynamoDB: `PutItem` (new channel item with new ID)

```
itemId = "channel#{team_id}#{new_channel_id}"
timestamp = "{event_ts}"
```

**Attributes:**
- Copy `name`, `names_history` from old channel (query if available)
- `prev_channel_id` = old_channel_id
- `raw_event`

---

**`channel_purpose`, `channel_topic`**

DynamoDB: `UpdateItem`

```
SET purpose = :purpose  # or topic = :topic
    raw_event = :raw_event
```

---

**`channel_convert_to_private` / `channel_convert_to_public`**

DynamoDB: `UpdateItem`

```
SET visibility = :visibility  # "private" or "public"
```

**Note:** Lambda continues storing events regardless of visibility. Visibility recorded for audit.

---

## Data Storage Rules

**Storage Optimization:**
- **Do NOT store false booleans** → omit attributes when false/absent
- Use `REMOVE` for attributes (e.g., `REMOVE archived` on unarchive)
- Cap `names_history` at 20 entries per channel

**File Metadata Whitelist** (store only these fields from Slack file object):
- `id`, `name`, `title`, `mimetype`, `filetype`, `size`, `url_private`, `mode`, `is_external`, `created`, `user`

**GSI (ThreadIndex) Fields** (sparse index, only for messages with `parent`):
- `parent` (partition key)
- `timestamp` (sort key)
- Projected: `ALL` (initially; optimize later if needed)

**Raw Event Storage:**
- Store full `raw_event` payload by default
- **Exception:** If specific whitelist defined for event type, use whitelist instead
- Allows debugging, can optimize later

---

## Error Handling

| Scenario | Response | Action |
|----------|----------|--------|
| Invalid signature | `401 Unauthorized` | Log attempt |
| Malformed JSON | `400 Bad Request` | Log payload |
| DynamoDB write error | `500 Internal Server Error` | Log error (TODO: DLQ) |
| Unknown event type | `200 OK` | Log event type, ignore |
| Slack retry (X-Slack-Retry-Num header) | Process normally | Ignore retry headers |

**Idempotency:**
- Use conditional writes where sensible (e.g., check `updated_ts` for edits)
- Overwrites acceptable for duplicate events
- Some data loss acceptable (not mission-critical)

---

## Logging

**Application Logs** (CloudWatch):
- Event type, channel_id, ts for each processed event
- Errors with full context (stack trace, event payload excerpt)
- Signature validation failures

**Level:** INFO for normal operations, ERROR for failures

---

## Out of Scope

- File downloads (handled by DDB stream Lambda) ✅ File processor implemented
- ChannelIndex management (handled by DDB stream Lambda) ✅ File processor implemented
- Channel type filtering (store all events, even private channels if bot is added) ✅ Stores all events regardless of visibility
- User entity storage (denormalize user info in messages only) ✅ Users stored in messages
- Backfill of historical messages (only real-time events captured)
- Rate limiting (rely on Slack's event delivery rate)

---

## DynamoDB Key Patterns Reference

```
Messages:      itemId="message#{team_id}#{channel_id}"     timestamp="{ts}"
Channels:      itemId="channel#{team_id}#{channel_id}"     timestamp="{event_ts}"
ChannelIndex:  itemId="channelindex#{team_id}"             timestamp="{shard_number}"

GSI (ThreadIndex):
               parent="thread#{team_id}#{thread_ts}"       timestamp="{ts}"
```

---

## Implementation Notes

1. **Message Subtype Evaluation:** Start by storing all unknown subtypes. After deployment with real data, refine the ignore list based on actual usage.

2. **Conditional Writes:** Use where it prevents obviously stale data (e.g., edit overwrites newer edit), but don't over-engineer. Accept some inconsistency.

3. **File Object Size:** Slack file objects contain many scaled image URLs (`thumb_64`, `thumb_360`, etc.). Use whitelist to avoid storing these.
