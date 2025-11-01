# Slack History MVP — AWS CDK Infrastructure Instructions (Shortened)

**Date:** November 1, 2025

**Scope:** Minimal CDK infra instructions for Slack History MVP.

**Defaults & constraints:**
- Language: TypeScript CDK v2.221.1+, Node.js 22+
- Application prefix: Mnemosyne
- Environment: Single production environment (no staging/dev in MVP scope)
- Region: eu-west-1
- Lambda Function URLs (AuthType.NONE) for Slack Events API; validate Slack signing secrets in handler.
- Single S3 artifact bucket reused across pipelines.
- No inline lambdas or buildspecs; external files in `infrastructure/buildspecs/`.
- GitHub connection via AWS CodeStar; manual auth after first deploy.
- CI role: permissions to execute deployments
- Secrets Manager: Slack bot token and Slack signing secret placeholders
- Pipeline trigger: main branch

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
  message-listener/
    src/...
  file-processor/
    src/...
  slack-shared/
    src/...
```

---

## Stacks
1. **BaseRolesStack**
   - S3 artifact bucket, Secrets Manager placeholders, CI role

2. **MainInfraStack**
   - DynamoDB single table `SlackArchive` (PK= `itemId`, SK=`timestamp`, GSI for threads)
   - S3 bucket for Slack files
   - Lambda `message-listener` (Function URL) and `file-processor` (stream processing)
   - Lambda permissions: DDB access, S3 write, Secrets Manager read

3. **Pipeline stacks**
   - **Infra pipeline**: triggers on all main branch pushes, combined CDK build & deploy (external buildspec)
   - **Listener pipeline**: triggers on all main branch pushes, combined Lambda build & deploy
   - **DDB stream pipeline**: triggers on all main branch pushes, combined Lambda build & deploy
   - All buildspecs are external files (no inline buildspecs)

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

