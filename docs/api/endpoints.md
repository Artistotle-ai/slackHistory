# API Endpoints

Lambda Function URLs exposed by Mnemosyne.

## Endpoints

### Message Listener
**URL:** Lambda Function URL (configured in Slack app manifest)  
**Method:** POST  
**Auth:** Slack signature verification  
**Definition:** [`../lambda-functions/message-listener.md`](../lambda-functions/message-listener.md)

Receives Slack Events API webhooks. Processes message and channel events, stores in DynamoDB.

**Events:**
- `message` - New messages
- `message_changed` - Message edits
- `message_deleted` - Message deletions
- `channel_created` - New channels
- `channel_rename` - Channel name changes
- `channel_deleted` - Channel deletions
- `channel_archive` / `channel_unarchive` - Archive status
- `channel_id_changed` - Channel ID changes
- `channel_purpose` / `channel_topic` - Purpose/topic updates
- `channel_convert_to_private` / `channel_convert_to_public` - Visibility changes

### OAuth Callback
**URL:** Lambda Function URL (configured in Slack app OAuth redirect URLs)  
**Method:** GET  
**Auth:** OAuth state parameter validation  
**Definition:** [`../lambda-functions/oauth-callback.md`](../lambda-functions/oauth-callback.md)

Handles Slack OAuth flow. Exchanges authorization code for bot token, stores in DynamoDB.

**Query Parameters:**
- `code` - OAuth authorization code
- `state` - CSRF protection token

**Response:** HTML page confirming installation

## Architecture

See [Infrastructure Architecture](../infrastructure/architecture.md) for deployment details.

