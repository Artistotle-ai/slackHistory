# Cost Optimization

Infrastructure configured for minimal AWS costs while maintaining functionality.

See [Architecture](./architecture.md) for resource details.

## S3 Lifecycle Policies

### Artifact Bucket (`mnemosyne-artifacts-*`)
**Purpose:** CodePipeline build artifacts

- Versioning: Suspended
- Expiration: 7 days (current objects)
- Noncurrent versions: 1 day

**Rationale:** Build artifacts are reproducible. No need for long retention or versioning.

### Files Bucket (`mnemosyne-slack-files-*`)
**Purpose:** Archived Slack file attachments

- Versioning: Suspended
- Transition to Infrequent Access: 90 days
- Noncurrent versions: 1 day

**Rationale:** Files rarely accessed after 90 days. Slack files have unique IDs, unlikely to be overwritten.

**Storage Classes:**
- 0-90 days: S3 Standard ($0.023/GB/month)
- 90+ days: S3 IA ($0.0125/GB/month, 46% cheaper)

## CloudWatch Logs

All Lambda functions have 7-day retention:
- `/aws/lambda/MnemosyneMessageListener`
- `/aws/lambda/MnemosyneFileProcessor`

**Cost:** ~$0.50/GB ingested. Logs older than 7 days auto-delete.

## DynamoDB

**Billing Mode:** PAY_PER_REQUEST (on-demand)

**Point-in-Time Recovery:** Disabled

PITR costs $0.20/GB/month for continuous backups. Disabled because:
- Requirements specify "accept data loss"
- Not mission-critical data
- Avoiding $240-2,400/year in backup costs

**Table has:**
- Primary keys: `itemId` (partition), `timestamp` (sort)
- GSI: `ThreadIndex` (sparse, on-demand)
- Stream: Not enabled (file-processor not yet implemented)

## Lambda

**Memory Sizing:**
- message-listener: 256 MB
- file-processor: 512 MB

**Architecture:** ARM64 (20% cheaper than x86)

**Runtime:** Node.js 22

## CodeBuild

**Compute:** BUILD_GENERAL1_SMALL (3GB RAM, 2 vCPU, ARM)

**Cost:** $0.005/minute (Linux ARM)

All pipelines use ARM architecture for 20% cost savings.

## Secrets Manager

**Active Secrets:**
- `Mnemosyne/slack/bot-token` ($0.40/month)
- `Mnemosyne/slack/signing-secret` ($0.40/month)

**Total:** $0.80/month ($9.60/year) - unavoidable for credential storage.

## Cost Breakdown (Estimated)

| Resource | Monthly Cost | Notes |
|----------|--------------|-------|
| DynamoDB (10M requests) | $1.25 | On-demand pricing |
| Lambda (1M invocations) | $0.20 | Free tier eligible |
| S3 Standard (10GB) | $0.23 | Growing with usage |
| S3 IA (50GB historical) | $0.63 | After 90-day transition |
| CloudWatch Logs | $5-8 | 7-day retention |
| CodeBuild | $11 | ~75 min/day builds |
| Secrets Manager | $0.80 | 2 secrets |
| **Total** | **~$19-22/month** | Scales with usage |

## Savings Implemented

Compared to default AWS configurations:

- CloudWatch unlimited retention → 7 days: **$60-120/year**
- S3 versioning disabled: **$10-15/year**
- S3 IA transitions: **$30-100/year**
- DynamoDB PITR disabled: **$240-2,400/year**

**Total Savings:** $340-2,635/year

## Monitoring Costs

```bash
# Check S3 storage
aws s3 ls s3://mnemosyne-slack-files-* --recursive --summarize

# DynamoDB table size
aws dynamodb describe-table --table-name MnemosyneSlackArchive \
  --query 'Table.TableSizeBytes' --output text

# CloudWatch storage (last 7 days only)
aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/Mnemosyne
```

## References

- [S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [DynamoDB Pricing](https://aws.amazon.com/dynamodb/pricing/)
- [Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
