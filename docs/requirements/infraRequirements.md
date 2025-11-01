# Slack History MVP — AWS CDK Infrastructure Instructions (Shortened)

**Scope:** Minimal CDK infra instructions for Slack History MVP.

**Defaults & constraints:**
- Language: TypeScript CDK v2.218.0+
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
   - **Infra pipeline**: watches `infrastructure/` folder, CDK synth & deploy
   - **Listener pipeline**: watches `message-listener/` folder, builds & deploys Lambda
   - **DDB stream pipeline**: watches `file-processor/`, builds & deploys Lambda, attaches stream event source

---

## Deployment order
1. Deploy BaseRolesStack (artifact bucket & secrets placeholders)
2. Authorize GitHub CodeStar connection
3. Deploy PipelineInfraStack → deploys MainInfraStack
4. Deploy PipelineListenerStack and PipelineDdbStreamStack
5. Populate Slack secrets in Secrets Manager
6. Configure Slack App to use Lambda Function URL

---

## References
- Lambda Function URL auth model: [AWS Docs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
- Use Slack signing secret verification in Lambda handler to secure public Function URL

---

All pipelines are path-filtered to deploy only when relevant folder changes occur. Artifact bucket is shared across pipelines for consistency.

End.

