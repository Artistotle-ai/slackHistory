import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { BaseRolesStack } from './base-roles-stack';

export interface PipelineInfraStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * PipelineInfraStack - CI/CD for infrastructure deployments
 * 
 * Automated pipeline for CDK infrastructure changes:
 * - Triggers on changes to infrastructure/ folder in main branch
 * - Uses CodeStar connection for GitHub integration
 * - Single CodeBuild step: npm ci, build, synth, deploy
 * - Deploys all CDK stacks automatically (no manual approval)
 * - Pipeline Type V2 for enhanced features and performance
 */
export class PipelineInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineInfraStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // Use static references to avoid cyclic dependencies
    // Resources are referenced by predictable naming patterns
    const artifactBucketName = `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;
    const githubConnectionArn = `arn:aws:codeconnections:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:connection/*`;

    // Create references using static names
    const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket', artifactBucketName);

    // Create pipeline - let CodePipeline create its own service roles
    this.createPipeline(appPrefix, artifactBucket);
  }

  private createPipeline(appPrefix: string, artifactBucket: s3.IBucket) {
    // Import GitHub connection ARN from BaseRolesStack export
    const githubConnectionArn = cdk.Fn.importValue(`${appPrefix}GitHubConnectionArn`);

    // Single CodeBuild project for CDK build and deploy
    const cdkBuildDeployProject = new codebuild.PipelineProject(this, 'CdkBuildDeployProject', {
      projectName: `${appPrefix}CdkBuildDeploy`,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'npm install -g aws-cdk',
            ],
          },
          build: {
            commands: [
              'cd infrastructure',
              'npm ci',
              'npm run build',
              'npx cdk synth --quiet',
              'npx cdk deploy --all --require-approval never --outputs-file outputs.json',
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
      },
    });

    // Grant CodeBuild permissions
    artifactBucket.grantReadWrite(cdkBuildDeployProject);

    // TODO: Add CloudFormation and CDK permissions to CodeBuild roles

    // CodePipeline for infrastructure deployment with file path triggers
    const pipeline = new codepipeline.Pipeline(this, 'InfraPipeline', {
      pipelineName: `${appPrefix}InfraPipeline`,
      artifactBucket: artifactBucket,
      pipelineType: codepipeline.PipelineType.V2,
      triggers: [
        {
          providerType: codepipeline.ProviderType.CODE_STAR_SOURCE_CONNECTION,
          gitConfiguration: {
            sourceAction: 'GitHub_Source' as any,
            pushFilter: [
              {
                tagsExcludes: [],
                tagsIncludes: [],
                filePaths: {
                  includes: ['infrastructure/**/*', 'slack/**/*', 'docs/**/*'],
                },
              },
            ],
          },
        },
      ],
    });

    // Source stage - GitHub source via CodeStar connection
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: 'GitHub_Source',
      owner: 'Artistotle-ai',
      repo: 'slackHistory',
      branch: 'main',
      connectionArn: githubConnectionArn, // Uses connection created in BaseRolesStack
      output: sourceOutput,
      triggerOnPush: false, // Triggers are configured at pipeline level
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Build and Deploy stage (combined)
    const buildDeployAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CDK_Build_Deploy',
      project: cdkBuildDeployProject,
      input: sourceOutput,
    });

    pipeline.addStage({
      stageName: 'Build_Deploy',
      actions: [buildDeployAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'InfraPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for infrastructure deployment',
    });
  }
}
