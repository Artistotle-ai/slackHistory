# Slack History MVP — Implementation Plan (Single-Table)

**Document scope:** Minimal commentary, concrete behaviour and architecture. No backfill, public HTTP events, Lambda-based, single DynamoDB table storing all entities via string prefixes.

---

## High-level architecture

```
        Slack (free workspace)
                |
        Events API (HTTP POST)
                |
        Lambda Function URL (HTTPS)
                |
        Lambda (Events Handler)
                |
        DynamoDB (Single Table)
                |
        DynamoDB Stream
                |
        Lambda (File Processor)
                |
                S3
```

Notes: public HTTP endpoint (LambdaFunction Url). No Socket Mode. No backfill. Only public channels. App keeps ingesting events for channels even after they become private (visibility recorded) — events are still stored.

---

## Single-table design (DynamoDB)

Table: `SlackArchive` (single table)

Primary keys:

- **itemId** (partition key) — string
- **timestamp** (sort key) — string

All item types are distinguished by a static prefix in itemId.

### Item types & key patterns

**Message item**

```
itemId = "message#{team_id}#{channel_id}"
timestamp = "{ts}"         # ts is Slack event timestamp (string)
```

**Channel item**

```
itemId = "channel#{team_id}#{channel_id}"
timestamp = "{event_ts}"  # event timestamp that produced the row
```

**ChannelIndex shard item**

```
itemId = "channelindex#{team_id}"
timestamp = "{shard_number}" //incremented when new shard is created (consistent read/write)
```

Other auxiliary rows (if needed) follow the same pattern `meta#{team_id}#{...}`.

### Global Secondary Index (for threads)

```
parent = "thread#{team_id}#{thread_ts}"   # GSI partition key (sparse, only on thread messages)
timestamp = "{ts}"                         # GSI sort key (message ts)
```

GSI is sparse: only messages that belong to a thread include `parent`.

---

## Item attributes (normalized)

Common attributes on message items:

- `type` = "message" (optional, for clarity)
- `team_id`
- `channel_id`
- `ts` (string)
- `text`
- `user` (if present)
- `thread_ts` (if present)
- `parent` = "thread#{team\_id}#{thread\_ts}" (if thread\_ts present)
- `deleted` = true (only set when deletion happens; otherwise absent to save space)
- `files` = array of Slack file metadata objects (raw subset)
- `files_s3` = array of s3 URIs (set by processor)
- `raw_event` = raw Slack JSON blob (optional; store if useful)
- `updated_ts` = last update timestamp (set on edits)

Common attributes on channel items:

- `type` = "channel" (optional)
- `team_id`
- `channel_id`
- `name`
- `names_history` = array (cap 20) of previous names
- `archived` = true (set on archive; **removed** on unarchive to save space)
- `deleted` = true (set on channel\_deleted; absent otherwise)
- `visibility` = "public" | "private"  (store current state; if private, we still store events)
- `purpose`
- `topic`
- `prev_channel_id` (set on id change)
- `raw_event`

ChannelIndex shard items contain a `channels_map` attribute (map channelId -> name) and `names_history` if useful for bulk lookup.

**Storage-footprint rules:**

- To save space, *do not write explicit false booleans.* Omit boolean attributes when false/absent.
- Use removal of attributes (e.g., `REMOVE archived`) rather than writing `archived = false` on unarchive events.
- Use `names_history` capped at 20 entries.
- ChannelIndex shards are created once an item exceeds \~200KB; `shard_number` increments.

---

## Event handling (HTTP Lambda behaviour) — concrete functionality per event

All handlers parse the incoming Slack event, filter out anything not related to public channels, normalize payload and write a single-row mutation to `SlackArchive` using the itemId/timestamp patterns above.

### `message` (new message)

- If `channel` is a public channel and not a private/DM type → proceed.
- Determine `parent`:
  - If `thread_ts` not present → no parent attribute.
  - If `thread_ts` present and `thread_ts == ts` → set `parent = "thread#{team_id}#{thread_ts}"` (parent message) and still store as ordinary message row.
  - If `thread_ts` present and `thread_ts != ts` → set `parent = "thread#{team_id}#{thread_ts}"` (reply).
- Write item: itemId=`message#{team_id}#{channel_id}`, timestamp=`{ts}`, include `files` if present.
- Do not set `deleted` attribute.

### `message_changed` (edit)

- Locate existing item: itemId=`message#{team_id}#{channel_id}`, timestamp=`{edited_ts}` (use event payload to find original ts).
- Update: overwrite `text`, `raw_event`, set `updated_ts = now()`.
- Upsert semantics: if item missing (rare) create it with `updated_ts`.

### `message_deleted` (delete)

- Locate item for the deleted message (based on payload).
- Update: `SET deleted = true` (write the attribute). Do not remove the item.

### Messages with `file_share` / `files`

- Write message item as above including Slack `files` metadata.
- **Do not attempt to download in this Lambda.** DynamoDB Stream will trigger the file processor.

### Channel events

#### `channel_created`

- Create channel item row: itemId=`channel#{team_id}#{channel_id}`, timestamp=`{event_ts}`. Set `name` and initial `names_history`.


#### `channel_rename` / `name` change

- Append new name to `names_history` on the channel item (push front, cap 20).
- Update channel item with updated `name` and `raw_event`.

#### `channel_deleted`

- Update channel item: `SET deleted = true` (attribute present).

#### `channel_archive`

- Update channel item: `SET archived = true`.

#### `channel_unarchive`

- Update channel item: **remove attribute** `archived` (DynamoDB `REMOVE archived`).
  - Rationale: saves space and follows rule "do not store false booleans".

#### `channel_id_changed`

- Create a new channel item for the new channelId with `prev_channel_id` pointing to previous id. Preserve name and history fields as available.

#### `channel_purpose`

- Update `purpose` attribute on channel item.

#### `channel_topic`

- Update `topic` attribute on channel item.

#### `channel_convert_to_private` / `channel_convert_to_public`

- Update `visibility` attribute to `private` or `public`.
- Note: even after `visibility = "private"` the app will continue storing events for that channel (policy decision). The channel's visibility value is recorded for auditing.

### Other notes on event writes

- All writes use conditional upsert semantics where appropriate to avoid accidental overwrites of newer data (compare `updated_ts` or event timestamps). Use lightweight conditional logic as needed.
- Keep `raw_event` optional to allow smaller items; storing full raw JSON is allowed for debugging but increases item size.

---

## DynamoDB Stream → Lambda (concrete)

**Trigger:** `INSERT` or `MODIFY` events from DynamoDB stream (NEW_AND_OLD_IMAGES view)

**Responsibilities:**
1. File processing (download Slack files to S3)
2. ChannelIndex maintenance (keep channel_id → name mapping updated)


### File Processing

Trigger condition: items where `files` exists and `files_s3` is absent (or incomplete).

For each file attachment in the message:

1. Try `files.info` (optional) to validate metadata.
2. Attempt HTTP GET `url_private` with header `Authorization: Bearer <bot-token>`.
3. If download succeeds, upload to S3 key `slack/{team_id}/{channel_id}/{ts}/{file_id}`.
4. Update the originating DynamoDB item: `SET files_s3 = list_append(if_not_exists(files_s3, :empty_list), :new_s3_refs)`.
5. On transient failures retry with exponential backoff; after N attempts mark item with `files_fetch_failed = true` and optionally record `files_fetch_error`.
6. If file URL is external (no `url_private`) skip (store external link in `files` only).

Idempotency: use file\_id in S3 key and conditional put to avoid duplicate uploads.

### ChannelIndex Maintenance

Trigger condition: `INSERT` or `MODIFY` on channel items (itemId starts with `"channel#"`).

**Channel created:** Upsert ChannelIndex shard with mapping `{channel_id: name}`

**Channel rename:** Update name in ChannelIndex mapping `{channel_id: new_name}`

**Channel deleted:** Prefix name with `deleted_` → `{channel_id: "deleted_<name>"}`

**Sharding:** When ChannelIndex item >350KB, create new shard (increment timestamp). Reserved concurrency = 1 ensures serial updates.

Permissions: Lambda must have network egress and proper IAM rights for S3 and to read encrypted secrets (bot token). Bot token usage requires secrecy — rotate/secure.

---

## Query patterns

- Retrieve channel messages: query where `itemId = "message#{team_id}#{channel_id}"` sorted by `timestamp`.
- Retrieve thread replies: query GSI where `parent = "thread#{team_id}#{thread_ts}"` sorted by `timestamp`.
- Get channel metadata: query where `itemId = "channel#{team_id}#{channel_id}"` and read latest `timestamp` event.
- Channel index lookup: query where `itemId = "channelindex#{team_id}"` scan shards to find channelId mapping (or maintain a small in-memory cache populated from shards).

---

## Minimal operational constraints

- Omit boolean attributes when false; remove `archived` on unarchive rather than set false.
- Cap name history at 20 entries per channel to bound item sizes.
- Shard the ChannelIndex to avoid 400KB item limit.
- For storage of raw JSON (optional), monitor item size; prefer selective fields when possible.

---

## Security & privacy (short)

- You intentionally accept privacy risk for MVP; record this clearly in your deployment docs and require explicit workspace consent.
- Secure the bot token (Secrets Manager/SSM) and rotate regularly.

---

## Appendix: Example item JSON (message)

```json
{
  "itemId": "message#T12345#C23456",
  "timestamp": "1620000000.000200",
  "type": "message",
  "team_id": "T12345",
  "channel_id": "C23456",
  "ts": "1620000000.000200",
  "text": "Hello world",
  "user": "U67890",
  "thread_ts": "1620000000.000100",
  "parent": "thread#T12345#1620000000.000100",
  "files": [{"id":"F111","url_private":"https://files.slack..."}],
  "files_s3": ["s3://slack-archive/T12345/C23456/1620000000.000200/F111"],
  "updated_ts": "2025-11-01T00:00:00Z"
}
```
