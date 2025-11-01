# Slack App Manifest

This folder contains the manifest for the Mnemosyne Slack app.

## Using the Manifest

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Click **Create New App** → **From an app manifest**
3. Select your workspace
4. Paste the contents of `manifest.json`
5. Click **Create**

## Post-Creation Setup

After creating the app from the manifest:

1. **Install to Workspace** - Grant the required permissions
2. **Get Credentials** - Copy bot token and signing secret
3. **Set Request URL** - Update the `request_url` in manifest.json with your Function URL
4. **Configure Secrets** - Store tokens in AWS Secrets Manager ([see secrets guide](../docs/infrastructure/secrets-setup.md))

## Manifest Configuration

The manifest includes:

- **Bot Scopes**: All permissions needed for message and file archiving
- **Event Subscriptions**: Real-time events for messages, channels, and files
- **Settings**: Token rotation enabled, interactivity disabled

**Note**: Replace `REPLACE_WITH_FUNCTION_URL` with your actual Lambda Function URL after deployment.

## Security

- Token rotation is enabled for security
- App uses minimal required permissions
- All data flows through your AWS account
