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

    // Create dedicated CI role for this pipeline stack
    const ciRole = new iam.Role(this, 'PipelineCiRole', {
      roleName: `${appPrefix}InfraPipelineCiRole`,
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      description: 'CI role for infrastructure pipeline',
    });

    // Add necessary permissions for CDK deployment
    ciRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:*',
        's3:*',
        'iam:*',
        'lambda:*',
        'dynamodb:*',
        'secretsmanager:*',
        'kms:*',
        'codeconnections:UseConnection',
      ],
      resources: ['*'], // TODO: Restrict to specific resources for security
    }));

    // Create pipeline with references
    this.createPipeline(appPrefix, artifactBucket, ciRole);
  }

  private createPipeline(appPrefix: string, artifactBucket: s3.IBucket, ciRole: iam.IRole) {
    // Reference GitHub connection created in BaseRolesStack
    const githubConnectionArn = `arn:aws:codeconnections:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:connection/*`;

    // CodeBuild project for CDK synth
    const cdkSynthProject = new codebuild.PipelineProject(this, 'CdkSynthProject', {
      projectName: `${appPrefix}CdkSynth`,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'cd infrastructure',
              'npm ci',
            ],
          },
          build: {
            commands: [
              'cd infrastructure',
              'npm run build',
              'npx cdk synth',
            ],
          },
        },
        artifacts: {
          'base-directory': 'infrastructure/cdk.out',
          files: '**/*',
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });

    // CodeBuild project for CDK deploy
    const cdkDeployProject = new codebuild.PipelineProject(this, 'CdkDeployProject', {
      projectName: `${appPrefix}CdkDeploy`,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'npm install -g aws-cdk', // TODO: Pin CDK version
            ],
          },
          build: {
            commands: [
              'cd infrastructure',
              'npx cdk deploy --require-approval never --outputs-file outputs.json',
              // TODO: Define specific stack deployment commands
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });

    // Grant CodeBuild permissions
    artifactBucket.grantReadWrite(cdkSynthProject);
    artifactBucket.grantReadWrite(cdkDeployProject);

    // TODO: Add CloudFormation and CDK permissions to CodeBuild roles

    // CodePipeline for infrastructure deployment
    const pipeline = new codepipeline.Pipeline(this, 'InfraPipeline', {
      pipelineName: `${appPrefix}InfraPipeline`,
      artifactBucket: artifactBucket,
      role: ciRole,
      pipelineType: codepipeline.PipelineType.V2,
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
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Synth stage
    const synthOutput = new codepipeline.Artifact('SynthOutput');
    const synthAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CDK_Synth',
      project: cdkSynthProject,
      input: sourceOutput,
      outputs: [synthOutput],
    });

    pipeline.addStage({
      stageName: 'Synth',
      actions: [synthAction],
    });

    // Deploy stage
    const deployAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CDK_Deploy',
      project: cdkDeployProject,
      input: synthOutput,
    });

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [deployAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'InfraPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for infrastructure deployment',
    });
  }
}
