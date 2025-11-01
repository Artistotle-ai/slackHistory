import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseRolesStack } from './base-roles-stack';

export interface PipelineListenerStackProps extends cdk.StackProps {
  appPrefix: string;
}

export class PipelineListenerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineListenerStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // Use static references to avoid cyclic dependencies
    // Resources are referenced by predictable naming patterns
    const artifactBucketName = `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;

    // Create references using static names
    const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket', artifactBucketName);

    // Create dedicated CI role for this pipeline stack
    const ciRole = new iam.Role(this, 'PipelineCiRole', {
      roleName: `${appPrefix}MessageListenerPipelineCiRole`,
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      description: 'CI role for message listener pipeline',
    });

    // Add necessary permissions for Lambda deployment
    ciRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:*',
        'iam:*',
        's3:*',
        'cloudformation:*',
      ],
      resources: ['*'], // TODO: Restrict to specific resources for security
    }));

    // Create pipeline with references
    this.createPipeline(appPrefix, artifactBucket, ciRole);
  }

  private createPipeline(appPrefix: string, artifactBucket: s3.IBucket, ciRole: iam.IRole) {
    // CodeBuild project for Lambda build
    const lambdaBuildProject = new codebuild.PipelineProject(this, 'LambdaBuildProject', {
      projectName: `${appPrefix}MessageListenerBuild`,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/message-listener-buildspec.yml'), // TODO: Create buildspec file
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        environmentVariables: {
          ARTIFACT_BUCKET: {
            value: artifactBucket.bucketName,
          },
        },
      },
    });

    // Grant permissions
    artifactBucket.grantReadWrite(lambdaBuildProject);

    // TODO: Add Lambda update permissions to CodeBuild role

    // CodePipeline for message-listener deployment
    const pipeline = new codepipeline.Pipeline(this, 'ListenerPipeline', {
      pipelineName: `${appPrefix}MessageListenerPipeline`,
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
      connectionArn: `arn:aws:codestar-connections:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:connection/REPLACE_WITH_CONNECTION_ID`, // TODO: Replace with actual CodeStar connection ARN
      output: sourceOutput,
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Build stage
    const buildOutput = new codepipeline.Artifact('BuildOutput');
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Lambda_Build',
      project: lambdaBuildProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });

    pipeline.addStage({
      stageName: 'Build',
      actions: [buildAction],
    });

    // TODO: Deploy stage - Lambda deployment
    // Note: LambdaDeployAction may not be available in CDK v2.221.1
    // Consider using CloudFormation or manual Lambda update in buildspec
    // const deployAction = new codepipeline_actions.LambdaDeployAction({
    //   actionName: 'Lambda_Deploy',
    //   lambda: lambda.Function.fromFunctionName(
    //     this,
    //     'MessageListenerFunction',
    //     `${appPrefix}MessageListener` // TODO: Reference actual Lambda function
    //   ),
    //   input: buildOutput,
    // });

    // Temporary placeholder - remove this stage for now
    const deployAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'Manual_Approval',
    });

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [deployAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'ListenerPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for message-listener Lambda deployment',
    });
  }
}
