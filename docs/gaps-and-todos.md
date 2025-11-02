# Gaps and Missing Features

**Date:** November 2, 2025  
**Status:** Gap analysis between documentation requirements and current implementation

This document tracks missing features, incomplete implementations, and verification tasks identified when comparing the requirements documentation with the current codebase.

---

## 🔴 Critical Missing Features

### 1. DynamoDB Stream Event Source Mapping
**Status:** Missing  
**Location:** `infrastructure/lib/main-infra-stack.ts:214` (marked as TODO)

**Issue:** File-processor Lambda is not connected to the DynamoDB stream, so it will never receive events.

**Required:**
- Enable DynamoDB stream on `SlackArchive` table
- Add event source mapping from stream to file-processor Lambda
- Stream view type: `NEW_AND_OLD_IMAGES`

**Related:** See TODO item #13 below

---

### 2. ChannelIndex Maintenance
**Status:** Not Implemented  
**Reference:** `docs/requirements/requirements.md:226-236`

**Issue:** File-processor Lambda should maintain ChannelIndex shards but this functionality is missing.

**Required Implementation:**
- Handle `INSERT` or `MODIFY` events on channel items (itemId starts with `"channel#"`)
- **Channel created:** Upsert ChannelIndex shard with mapping `{channel_id: name}`
- **Channel rename:** Update name in ChannelIndex mapping `{channel_id: new_name}`
- **Channel deleted:** Prefix name with `deleted_` → `{channel_id: "deleted_<name>"}`
- **Sharding:** When ChannelIndex item >350KB, create new shard (increment timestamp)
- Reserved concurrency = 1 ensures serial updates

**Location:** Should be added to `functions/file-processor/src/index.ts`

---

### 3. File Processor Reserved Concurrency
**Status:** Missing  
**Reference:** `docs/requirements/requirements.md:209`

**Issue:** File-processor Lambda needs reserved concurrency = 1 to serialize ChannelIndex updates and prevent race conditions.

**Required:**
- Set `reservedConcurrentExecutions: 1` on file-processor Lambda in `infrastructure/lib/main-infra-stack.ts`

---

## 🟠 Important Missing Features

### 4. File Processor Retry Logic
**Status:** Partially Implemented  
**Reference:** `docs/requirements/requirements.md:221`

**Issue:** Current implementation marks items as failed but doesn't implement exponential backoff retry logic.

**Required:**
- Implement exponential backoff retry logic for file downloads
- After N attempts, mark item with `files_fetch_failed = true`
- Optionally record `files_fetch_error` message

**Current State:** Basic failure marking exists (line 253-267 in file-processor), but no retry mechanism.

---

### 5. File Info Validation
**Status:** Not Implemented  
**Reference:** `docs/requirements/requirements.md:217`

**Issue:** Documentation suggests optional `files.info` API call validation before downloading.

**Required:**
- Optional call to Slack `files.info` API to validate file metadata before download
- Currently only uses `url_private` directly

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
**Status:** Unknown  
**Reference:** `infrastructure/lib/main-infra-stack.ts`

**Issue:** DynamoDB stream must be enabled on the table for file-processor to work.

**Required:**
- Enable stream on `SlackArchive` table
- Stream view type: `NEW_AND_OLD_IMAGES`

**Verification:** Check `main-infra-stack.ts` for `stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES`

---

### 8. OAuth Callback Pipeline
**Status:** Needs Verification  
**Reference:** `infrastructure/lib/pipeline-oauth-callback-stack.ts`

**Issue:** Verify OAuth callback Lambda has a CI/CD pipeline configured.

**Required:**
- Pipeline exists in `infrastructure/lib/pipeline-oauth-callback-stack.ts`
- Pipeline is registered in `infrastructure/bin/infra.ts`
- Buildspec exists in `infrastructure/buildspecs/oauth-callback-buildspec.yml`

**Verification:** Check if pipeline stack is created and deployed.

---

### 9. Dead Letter Queue
**Status:** Missing  
**Reference:** `docs/requirements/message-listener-requirements.md:41, 259`

**Issue:** Message-listener Lambda should have a DLQ for DynamoDB write errors.

**Required:**
- Add DLQ for message-listener Lambda
- Configure DLQ in `infrastructure/lib/main-infra-stack.ts`
- Handle retries for transient failures

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
**Status:** Needs Review  
**Location:** `functions/message-listener/src/index.ts:82`

**Issue:** Handler returns `200 OK` on errors which may hide issues.

**Current Behavior:** 
```typescript
return createSuccessResponse(); // Always returns 200
```

**Required Behavior:**
- Return `500 Internal Server Error` for DynamoDB errors
- Return `400 Bad Request` for malformed payloads
- Return `401 Unauthorized` for invalid signatures
- Return `200 OK` only for successful processing

**Reference:** `docs/requirements/message-listener-requirements.md:259`

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
**Status:** Needs Verification  
**Reference:** `docs/requirements/message-listener-requirements.md:238`

**Required Fields:**
- `id`, `name`, `title`, `mimetype`, `filetype`, `size`, `url_private`, `mode`, `is_external`, `created`, `user`

**Verification:** Check `whitelistFileMetadata` function in `slack-shared` to ensure only these fields are stored.

**Location:** Should be in `functions/slack-shared/src/utils/utils.ts` or similar.

---

### 14. File Processor Environment Variables
**Status:** Needs Verification  
**Location:** `infrastructure/lib/main-infra-stack.ts:202-210`

**Required Variables:**
- `SLACK_ARCHIVE_TABLE` - ✅ Present
- `SLACK_FILES_BUCKET` - ✅ Present
- `SLACK_CLIENT_ID_ARN` - ✅ Present
- `SLACK_CLIENT_SECRET_ARN` - ✅ Present

**Verification:** Ensure all environment variables are correctly set and accessible.

---

### 15. ChannelIndex Query Pattern
**Status:** Needs Documentation  
**Reference:** `docs/requirements/requirements.md:247`

**Issue:** Query pattern is documented but implementation may be missing.

**Required:**
- Query where `itemId = "channelindex#{team_id}"`
- Scan shards to find channelId mapping
- Or maintain in-memory cache populated from shards

**Verification:** Check if this query pattern is implemented anywhere.

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
**Critical:** 3  
**Important:** 3  
**Infrastructure:** 4  
**Verification:** 10

### Priority Order

1. **DynamoDB Stream Event Source Mapping** - Blocks file processing entirely
2. **DynamoDB Table Stream Enabled** - Required for #1 to work
3. **ChannelIndex Maintenance** - Missing core feature
4. **File Processor Reserved Concurrency** - Prevents race conditions
5. **Dead Letter Queue** - Error handling and retries
6. **Message Listener Error Handling** - Proper HTTP status codes
7. **File Processor Retry Logic** - Handle transient failures
8. **Pipeline Path Filters** - Optimize CI/CD triggers
9. **All verification tasks** - Ensure correctness

---

## 🔗 Related Documentation

- [Requirements](requirements/requirements.md) - Main requirements document
- [Message Listener Requirements](requirements/message-listener-requirements.md) - Lambda requirements
- [Infrastructure Requirements](requirements/infraRequirements.md) - CDK requirements
- [Message Listener Documentation](lambda-functions/message-listener.md) - Implementation docs
- [File Processor Documentation](lambda-functions/file-processor.md) - Implementation docs

---

*Last updated: November 2, 2025*

