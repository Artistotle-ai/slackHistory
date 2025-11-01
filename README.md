# Slack History MVP

An MVP application that stores all Slack messages, channels, and files to bypass Slack's free plan history limitations. Messages are stored in DynamoDB, files are saved to S3, and threads are efficiently indexed for retrieval.

## Scope & Limitations

- **No backfill**: Only processes new events from deployment time forward
- **No history reading**: Does not fetch existing messages from Slack
- **MVP only**: Privacy and metadata handling are minimal
- **New data only**: Real-time event ingestion only

## Important Considerations

⚠️ **Privacy & Legal Warning**: This application stores all messages, including private content, in cloud storage. Installing and running this is **not recommended** for any company without careful consideration. It's intended for early-stage startups and friends on free plans where all participants understand and agree to having this in the workspace.

⚠️ **Terms of Service**: This may violate Slack's Terms and Conditions. Use at your own risk.

For organizations needing similar functionality with proper privacy controls, consider Slack's Discovery/Enterprise export APIs instead.

