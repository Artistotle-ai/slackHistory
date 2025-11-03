# Slack History MVP — AWS CDK Infrastructure Instructions (Shortened)

**Date:** November 1, 2025

**Scope:** Minimal CDK infra instructions for Slack History MVP.

**Defaults & constraints:**
- Language: TypeScript CDK v2.221.1+, Node.js 20+ ✅ IMPLEMENTED
- Application prefix: Mnemosyne ✅ IMPLEMENTED
- Environment: Single production environment (no staging/dev in MVP scope) ✅ IMPLEMENTED
- Region: eu-west-1 (configurable via AWS_REGION) ✅ IMPLEMENTED
- Lambda Function URLs (AuthType.NONE) for Slack Events API; validate Slack signing secrets in handler ✅ IMPLEMENTED
- Single S3 artifact bucket reused across pipelines ✅ IMPLEMENTED
- No inline lambdas or buildspecs; external files in `infrastructure/buildspecs/` ✅ IMPLEMENTED
- GitHub connection via AWS CodeStar; manual auth after first deploy ✅ IMPLEMENTED
- CI role: permissions to execute deployments ✅ IMPLEMENTED
- Secrets Manager: Slack credentials (signing secret, client ID, client secret) ✅ IMPLEMENTED
- Pipeline trigger: main branch ✅ IMPLEMENTED

---

## Folder structure
```
repo/
  infrastructure/
    bin/infra.ts
    lib/
      base-roles-stack.ts
      main-infra-stack.ts
      pipeline-infra-stack.ts
      pipeline-listener-stack.ts
      pipeline-ddb-stream-stack.ts
    buildspecs/
  functions/message-listener/
    src/...
  functions/file-processor/
    src/...
  functions/slack-shared/
    src/...
```

---

## Stacks
1. **BaseRolesStack** ✅ IMPLEMENTED
   - S3 artifact bucket ✅ IMPLEMENTED
   - Secrets Manager placeholders (signing secret, client ID, client secret) ✅ IMPLEMENTED
   - GitHub CodeStar connection ✅ IMPLEMENTED

2. **MainInfraStack** ✅ IMPLEMENTED
   - DynamoDB single table `SlackArchive` (PK= `itemId`, SK=`timestamp`, GSI for threads) ✅ IMPLEMENTED
   - DynamoDB Stream (NEW_AND_OLD_IMAGES) ✅ IMPLEMENTED
   - S3 bucket for Slack files ✅ IMPLEMENTED
   - Lambda `message-listener` (Function URL, DLQ) ✅ IMPLEMENTED
   - Lambda `file-processor` (stream processing, reserved concurrency: 1) ✅ IMPLEMENTED
   - Lambda `oauth-callback` (Function URL) ✅ IMPLEMENTED
   - Lambda permissions: DDB access, S3 write, Secrets Manager read ✅ IMPLEMENTED

3. **Pipeline stacks** ✅ IMPLEMENTED
   - **PipelineInfraStack**: triggers on all main branch pushes, combined CDK build & deploy (external buildspec) ✅ IMPLEMENTED
   - **PipelineLambdasStack**: unified pipeline for all Lambda functions ✅ IMPLEMENTED
   - All buildspecs are external files ✅ IMPLEMENTED

## Cross-Stack Dependencies
Pipeline stacks create their own dedicated CI roles and use static resource references to avoid cyclic dependencies. Each pipeline is self-contained and doesn't depend on other stacks.

**Resource Naming Patterns:**
- S3 Artifact Bucket: `{appPrefix}-artifacts-{accountId}-{region}` (lowercase)
- Shared CI Role (BaseRolesStack): `{appPrefix}CiRole` (for future use)
- Pipeline-specific CI Roles: `{appPrefix}{PipelineName}PipelineCiRole`
- Slack Secrets: `{appPrefix}/slack/bot-token`, `{appPrefix}/slack/signing-secret`

**Deployment Strategy:**
- All stacks deploy simultaneously - no ordering dependencies
- Each pipeline stack creates its own CI role with appropriate permissions
- Artifact bucket is shared across all pipelines using static references

**Resource Cleanup:**
- S3 buckets use `autoDeleteObjects: true` to automatically empty before deletion
- All resources use `removalPolicy: DESTROY` for MVP (change to RETAIN for production)
- Resources are automatically cleaned up when removed from template or on stack failure

---

## Deployment order
1. **Simultaneous deployment**: All CDK stacks can be deployed together using `cdk deploy` (no cyclic dependencies)
2. Authorize GitHub CodeStar connection (manual step after deployment)
3. Populate Slack secrets in Secrets Manager (bot token and signing secret)
4. Configure Slack App to use Lambda Function URL
5. Pipelines will automatically trigger on code changes to respective folders

**Post-deployment steps:**
- Set up GitHub webhook for pipeline triggers
- Configure Slack app with the Function URL endpoint
- Add bot token and signing secret to Secrets Manager

---

## References
- Lambda Function URL auth model: [AWS Docs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
- Use Slack signing secret verification in Lambda handler to secure public Function URL

---

All pipelines are path-filtered to deploy only when relevant folder changes occur. Artifact bucket is shared across pipelines for consistency.

End.

