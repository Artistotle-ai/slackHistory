# Slack Secrets Setup

Configure Slack credentials for Mnemosyne.

## Required Secrets

- **Bot Token** (`xoxb-...`) - API authentication
- **Signing Secret** - Webhook verification

## Create Slack App

**Option 1: Using Manifest (Recommended)**
1. [Slack API Dashboard](https://api.slack.com/apps) → **Create New App** → **From an app manifest**
2. Select workspace, paste contents of `slack/manifest.json`
3. Click **Create**

**Option 2: Manual Setup**
1. [Slack API Dashboard](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name: `Mnemosyne`, select workspace, create

## Configure Scopes

**OAuth & Permissions** → **Bot Token Scopes**:
- `channels:history` - Public channel messages
- `channels:read` - Channel info
- `files:read` - File access
- `groups:history` - Private channel messages
- `groups:read` - Private channel info  
- `users:read` - User info

## Install App

1. **Install to Workspace** → Allow
2. Copy **Bot User OAuth Token** (starts with `xoxb-`)
3. **Basic Information** → **App Credentials** → Copy **Signing Secret**

## Store in AWS

```bash
# Bot token
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/bot-token \
  --secret-string "xoxb-your-token"

# Signing secret
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/signing-secret \
  --secret-string "your-secret"
```

## Configure Events

**Event Subscriptions** → Enable → Set Request URL (from deployment outputs)

**Subscribe to:**
- `message.channels`, `message.groups`
- `channel_created`, `channel_deleted`, `channel_archive`, `channel_unarchive`, `channel_rename`, `channel_id_changed`
- `file_shared`

Save changes.

## Security

**Rotate tokens:**
```bash
aws secretsmanager update-secret \
  --secret-id Mnemosyne/slack/bot-token \
  --secret-string "xoxb-new-token"
```

**IAM permissions:**
- Limit to `secretsmanager:GetSecretValue` on `Mnemosyne/slack/*`
- Enable CloudTrail logging
- Never commit tokens to git

## Troubleshooting

**Verification failed:**
```bash
# Check Lambda logs
aws logs tail /aws/lambda/MnemosyneMessageListener --follow

# Test URL
curl -X POST https://your-function-url.lambda-url.eu-west-1.on.aws/
```

**Token invalid:**
- Verify token starts with `xoxb-`
- Check correct workspace
- Regenerate token if needed

## References

- [Slack API Docs](https://api.slack.com/docs)
- [OAuth Scopes](https://api.slack.com/scopes)
- [Event Types](https://api.slack.com/events)
