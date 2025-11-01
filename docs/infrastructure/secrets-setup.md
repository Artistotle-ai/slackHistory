# Slack Secrets Setup

Configure Slack credentials for Mnemosyne using the app manifest.

## Required Secrets

- **Bot Token** (`xoxb-...`) - API authentication for posting messages, reading events
- **Signing Secret** - Webhook verification for request validation

## Create Slack App from Manifest

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Click **Create New App** → **From an app manifest**
3. Select your workspace
4. Paste the entire contents of `slack/manifest.json`
5. Click **Create**

The manifest includes all required permissions and event subscriptions.

## Get Bot Token

**Bot tokens** (xoxb-...) authenticate API calls to Slack.

### How to Get Your Bot Token:

1. Open your Slack app (Mnemosyne) in the [API Dashboard](https://api.slack.com/apps)
2. Navigate to **OAuth & Permissions** in the left sidebar
3. Scroll down to **Bot Token Scopes** - verify these scopes are present:
   - `channels:history`, `channels:read`
   - `files:read`, `groups:history`, `groups:read`
   - `users:read`
4. Click **Install to Workspace** (or **Reinstall to Workspace** if already installed)
5. Grant permissions when prompted
6. After installation, you'll see **Bot User OAuth Token** - this is your `xoxb-...` token
7. Copy the token (keep it secure)

## Get Signing Secret

1. In your app settings, go to **Basic Information**
2. Scroll to **App Credentials**
3. Copy the **Signing Secret** (used to verify webhook requests from Slack)

## Store Secrets in AWS

After getting both tokens, store them in AWS Secrets Manager:

```bash
# Store bot token
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/bot-token \
  --secret-string "xoxb-your-actual-token-here"

# Store signing secret
aws secretsmanager put-secret-value \
  --secret-id Mnemosyne/slack/signing-secret \
  --secret-string "your-actual-signing-secret-here"
```

## Update Manifest with Function URL

After AWS deployment, update the manifest:

1. Get your Function URL from CloudFormation outputs
2. Edit `slack/manifest.json`
3. Replace `REPLACE_WITH_FUNCTION_URL` with your actual Lambda Function URL
4. Recreate the Slack app with the updated manifest if needed

## Verify Setup

Test that your app is working:

```bash
# Check secrets exist
aws secretsmanager describe-secret --secret-id Mnemosyne/slack/bot-token
aws secretsmanager describe-secret --secret-id Mnemosyne/slack/signing-secret
```

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
