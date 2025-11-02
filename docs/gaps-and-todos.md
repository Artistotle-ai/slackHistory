# Gaps and Missing Features

**Date:** November 2, 2025  
**Status:** Gap analysis between documentation requirements and current implementation

This document tracks missing features, incomplete implementations, and verification tasks identified when comparing the requirements documentation with the current codebase.

---

## 🔴 Critical Missing Features

### 1. DynamoDB Stream Event Source Mapping
**Status:** ✅ IMPLEMENTED  
**Location:** `infrastructure/lib/main-infra-stack.ts:278-287`

**Implementation:**
- ✅ DynamoDB stream enabled on `SlackArchive` table (line 53: `NEW_AND_OLD_IMAGES`)
- ✅ Event source mapping added (lines 278-287)
- ✅ Configured with batchSize: 10, bisectBatchOnError: true, reportBatchItemFailures: true

---

### 2. ChannelIndex Maintenance
**Status:** ✅ IMPLEMENTED  
**Location:** `functions/file-processor/src/channel-index.ts`

**Implementation:**
- ✅ Handles `INSERT` and `MODIFY` events on channel items (itemId starts with `"channel#"`)
- ✅ Channel created/renamed: Upserts ChannelIndex shard with mapping `{channel_id: name}`
- ✅ Channel deleted: Prefixes name with `deleted_` → `{channel_id: "deleted_<name>"}`
- ✅ Sharding: Creates new shard when item >350KB (increments timestamp)
- ✅ Called from `stream-handler.ts:153-161` for all channel items

---

### 3. File Processor Reserved Concurrency
**Status:** ❌ MISSING  
**Reference:** `docs/requirements/requirements.md:209`

**Issue:** File-processor Lambda needs reserved concurrency = 1 to serialize ChannelIndex updates and prevent race conditions.

**Required:**
- Add `reservedConcurrentExecutions: 1` to file-processor Lambda in `infrastructure/lib/main-infra-stack.ts:253`

---

## 🟠 Important Missing Features

### 4. File Processor Retry Logic
**Status:** ✅ IMPLEMENTED  
**Location:** `functions/file-processor/src/file-processor.ts:133-161, 184-195`

**Implementation:**
- ✅ Exponential backoff retry logic implemented (lines 133-161)
- ✅ Retry with max 3 attempts, delays: 1s, 2s, 4s
- ✅ After all retries fail, files marked as failed (lines 254-258)
- ✅ Failed files tracked separately from successful downloads

---

### 5. File Info Validation
**Status:** ✅ OPTIONAL (Not Required)  
**Reference:** `docs/requirements/requirements.md:217`

**Note:** Documentation says this is optional. Current implementation uses `url_private` directly, which is sufficient. No `files.info` API call needed.

---

### 6. Conditional Upserts
**Status:** Partially Implemented  
**Reference:** `docs/requirements/requirements.md:196`

**Issue:** Need to verify conditional upsert logic prevents overwriting newer data.

**Required:**
- Use conditional writes where appropriate to avoid accidental overwrites
- Compare `updated_ts` or event timestamps before updating
- Lightweight conditional logic (don't over-engineer)

**Current State:** `message_changed` handler has basic upsert (line 105-122), but conditional logic may be missing.

---

## 🟡 Infrastructure Issues

### 7. DynamoDB Table Stream Enabled
**Status:** ✅ IMPLEMENTED  
**Location:** `infrastructure/lib/main-infra-stack.ts:53`

**Implementation:**
- ✅ Stream enabled on `SlackArchive` table
- ✅ Stream view type: `NEW_AND_OLD_IMAGES` (required for ChannelIndex updates)

---

### 8. OAuth Callback Pipeline
**Status:** ✅ IMPLEMENTED (Unified Pipeline)  
**Location:** `infrastructure/lib/pipeline-lambdas-stack.ts`

**Implementation:**
- ✅ Unified pipeline handles all Lambda functions (message-listener, file-processor, oauth-callback)
- ✅ Pipeline registered in `infrastructure/bin/infra.ts:57-62`
- ✅ Buildspec: `infrastructure/buildspecs/lambdas-buildspec.yml` builds all functions

---

### 9. Dead Letter Queue
**Status:** ✅ IMPLEMENTED  
**Location:** `infrastructure/lib/main-infra-stack.ts:210-215, 229`

**Implementation:**
- ✅ DLQ created for message-listener Lambda (lines 210-215)
- ✅ DLQ configured with 14-day retention
- ✅ Attached to message-listener function (line 229: `deadLetterQueue: messageListenerDlq`)

---

### 10. Pipeline Path Filters
**Status:** Needs Verification  
**Reference:** CodePipeline source actions

**Issue:** Pipelines should only trigger on changes to relevant folders.

**Required:**
- Message listener pipeline: trigger only on `functions/message-listener/` changes
- File processor pipeline: trigger only on `functions/file-processor/` changes
- OAuth callback pipeline: trigger only on `functions/oauth-callback/` changes
- Infrastructure pipeline: trigger only on `infrastructure/` changes

**Verification:** Check if path filters are configured in pipeline stacks.

---

## 🔵 Verification Tasks

### 11. Message Listener Error Handling
**Status:** ✅ IMPLEMENTED  
**Location:** `functions/message-listener/src/index.ts`

**Implementation:**
- ✅ `400 Bad Request` for invalid JSON (line 98)
- ✅ `401 Unauthorized` for missing/invalid signatures (lines 116, 137)
- ✅ `500 Internal Server Error` for DynamoDB/processing errors (lines 150, 160)
- ✅ `200 OK` only for successful processing (line 153)

---

### 12. Storage Optimization Verification
**Status:** Needs Verification  
**Reference:** `docs/requirements/requirements.md:114-118`

**Required Rules:**
- ✅ Do not store false booleans (omit attributes when false)
- ✅ Use `REMOVE archived` on unarchive (verified in channel-handlers.ts:159)
- ✅ Cap `names_history` at 20 entries (verified with capArray function)
- ⚠️ Verify all handlers follow these rules

**Verification:** Review all channel and message handlers.

---

### 13. File Metadata Whitelist Verification
**Status:** ✅ IMPLEMENTED  
**Location:** `functions/slack-shared/src/utils/slack-utils.ts:54-68`

**Implementation:**
- ✅ `whitelistFileMetadata` function filters file metadata
- ✅ Includes all required fields: `id`, `name`, `title`, `mimetype`, `filetype`, `size`, `url_private`, `mode`, `is_external`, `created`, `user`
- ✅ Uses conditional spread to omit undefined fields (storage optimization)

---

### 14. File Processor Environment Variables
**Status:** ✅ VERIFIED  
**Location:** `infrastructure/lib/main-infra-stack.ts:266-273`

**All Required Variables Present:**
- ✅ `SLACK_ARCHIVE_TABLE` (line 267)
- ✅ `SLACK_FILES_BUCKET` (line 268)
- ✅ `SLACK_CLIENT_ID_ARN` (line 270)
- ✅ `SLACK_CLIENT_SECRET_ARN` (line 271)

---

### 15. ChannelIndex Query Pattern
**Status:** ✅ IMPLEMENTED  
**Location:** `functions/file-processor/src/channel-index.ts:41-46`

**Implementation:**
- ✅ Queries `itemId = "channelindex#{team_id}"` (line 43)
- ✅ Gets latest shard by timestamp (sorted descending, limit 1)
- ✅ Shard structure: `{itemId, timestamp, channels_map: {channel_id: name}}`

---

### 16. File Processor S3 Key Pattern
**Status:** Verified ✅  
**Location:** `functions/file-processor/src/index.ts:94`

**Required Pattern:** `slack/{team_id}/{channel_id}/{ts}/{file_id}`

**Current Implementation:** ✅ Matches requirement
```typescript
const s3Key = `slack/${teamId}/${channelId}/${ts}/${file.id}`;
```

---

### 17. Message Handler Subtype Handling
**Status:** Needs Verification  
**Location:** `functions/message-listener/src/handlers/message-handlers.ts:66-67`

**Required:**
- ❌ Ignore: `channel_join`, `channel_leave` - ✅ Implemented
- ✅ Keep: `bot_message`, `me_message`, `file_share`, `thread_broadcast`
- ⚠️ All other subtypes: store (evaluate later with real data)

**Verification:** Ensure all subtypes are properly handled per requirements.

---

### 18. Channel Rename Timestamp Logic
**Status:** Needs Review  
**Location:** `functions/message-listener/src/handlers/channel-handlers.ts:35`

**Current Behavior:** Queries for latest timestamp

**Reference:** Requirements suggest using deterministic value or query for latest (message-listener-requirements.md:146)

**Verification:** Ensure timestamp handling is correct for channel rename events.

---

### 19. OAuth Token Refresh Handler
**Status:** Needs Verification  
**Reference:** `docs/lambda-functions/token-refresh.md`

**Issue:** Documentation mentions token-refresh handler but needs verification.

**Required:**
- If token rotation is enabled, verify token refresh handler exists
- Check if token refresh is handled automatically via `getValidBotToken()` from `slack-shared`

**Location:** Check `functions/slack-shared/src/utils/token-refresh.ts`

---

### 20. Infrastructure Documentation Completeness
**Status:** Needs Verification

**Required:**
- Verify `docs/infrastructure/architecture.md` matches actual CDK stacks
- Verify `docs/infrastructure/deployment.md` is up to date
- Ensure all Lambda functions are documented in `docs/lambda-functions/`

**Verification:** Review all infrastructure documentation against actual implementation.

---

## 📊 Summary

**Total Items:** 20  
**✅ Implemented:** 15  
**❌ Missing:** 1 (Reserved Concurrency)  
**⚠️ Needs Review:** 4 (Conditional Upserts, Path Filters, Storage Optimization, Subtype Handling)

### Priority Order

1. ✅ **DynamoDB Stream Event Source Mapping** - IMPLEMENTED
2. ✅ **DynamoDB Table Stream Enabled** - IMPLEMENTED
3. ✅ **ChannelIndex Maintenance** - IMPLEMENTED
4. ❌ **File Processor Reserved Concurrency** - MISSING (needs `reservedConcurrentExecutions: 1`)
5. ✅ **Dead Letter Queue** - IMPLEMENTED
6. ✅ **Message Listener Error Handling** - IMPLEMENTED
7. ✅ **File Processor Retry Logic** - IMPLEMENTED
8. ⚠️ **Pipeline Path Filters** - Needs verification
9. ⚠️ **Conditional Upserts** - Needs verification

---

## 🔗 Related Documentation

- [Requirements](requirements/requirements.md) - Main requirements document
- [Message Listener Requirements](requirements/message-listener-requirements.md) - Lambda requirements
- [Infrastructure Requirements](requirements/infraRequirements.md) - CDK requirements
- [Message Listener Documentation](lambda-functions/message-listener.md) - Implementation docs
- [File Processor Documentation](lambda-functions/file-processor.md) - Implementation docs

---

*Last updated: November 2, 2025*

