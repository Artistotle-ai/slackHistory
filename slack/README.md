# Slack App Manifest

Ready-to-use Slack app configuration for Mnemosyne.

## Quick Setup

1. [Slack API Dashboard](https://api.slack.com/apps)
2. **Create New App** → **From an app manifest**
3. Select workspace → Paste `manifest.json` content → **Create**
4. **Install to Workspace** → Grant permissions
5. Copy **Bot User OAuth Token** and **Signing Secret**
6. Store in AWS Secrets Manager ([full guide](../docs/infrastructure/secrets-setup.md))

## Manifest Contents

**Pre-configured:**
- All required bot permissions (message/file access)
- Event subscriptions for real-time message capture
- Proper app metadata and description
- Security settings (interactivity disabled)

**Requires update after AWS deployment:**
- Replace `REPLACE_WITH_FUNCTION_URL` with your Lambda Function URL

## Security Features

- Minimal required permissions only
- Token rotation available
- Webhook verification enabled
- No interactive features (bot-only)
