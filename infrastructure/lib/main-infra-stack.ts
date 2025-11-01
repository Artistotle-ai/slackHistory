import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { BaseRolesStack } from './base-roles-stack';

export interface MainInfraStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * MainInfraStack - Core application infrastructure
 * 
 * Deploys the primary Slack archiving resources:
 * - DynamoDB single-table for messages, channels, and metadata
 * - Global Secondary Index for efficient thread retrieval
 * - S3 bucket for Slack file storage
 * - Lambda function (message-listener) with Function URL for Slack Events API
 * - Lambda function (file-processor) for DynamoDB stream processing
 * - IAM roles and permissions for Lambda execution
 */
export class MainInfraStack extends cdk.Stack {
  public readonly slackArchiveTable: dynamodb.Table;
  public readonly slackFilesBucket: s3.Bucket;
  public readonly messageListenerFunction: lambda.Function;
  public readonly fileProcessorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: MainInfraStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // DynamoDB single table for Slack Archive
    this.slackArchiveTable = new dynamodb.Table(this, 'SlackArchiveTable', {
      tableName: `${appPrefix}SlackArchive`,
      partitionKey: {
        name: 'itemId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // TODO: Change to RETAIN for production
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // GSI for thread retrieval (sparse index)
    this.slackArchiveTable.addGlobalSecondaryIndex({
      indexName: 'ThreadIndex',
      partitionKey: {
        name: 'parent',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // S3 bucket for Slack files
    this.slackFilesBucket = new s3.Bucket(this, 'SlackFilesBucket', {
      bucketName: `${appPrefix.toLowerCase()}-slack-files-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      // TODO: Define lifecycle rules for file retention (disabled for MVP)
    });

    // Lambda execution role with necessary permissions
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `${appPrefix}LambdaExecutionRole`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // Add basic Lambda execution permissions
    lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Add DynamoDB permissions
    this.slackArchiveTable.grantReadWriteData(lambdaExecutionRole);

    // Add S3 permissions
    this.slackFilesBucket.grantReadWrite(lambdaExecutionRole);

    // TODO: Add Secrets Manager read permissions for Slack secrets

    // Message listener Lambda function
    this.messageListenerFunction = new lambda.Function(this, 'MessageListenerFunction', {
      functionName: `${appPrefix}MessageListener`,
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset('../message-listener/src'), // TODO: Update path when Lambda code is ready
      handler: 'index.handler',
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SLACK_ARCHIVE_TABLE: this.slackArchiveTable.tableName,
        // TODO: Add environment variables for secrets ARNs
      },
    });

    // Function URL for Slack Events API
    const messageListenerUrl = this.messageListenerFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Public endpoint
      cors: {
        allowedOrigins: ['*'], // TODO: Restrict to Slack domains for security
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['*'],
      },
    });

    // File processor Lambda function (triggered by DynamoDB stream)
    this.fileProcessorFunction = new lambda.Function(this, 'FileProcessorFunction', {
      functionName: `${appPrefix}FileProcessor`,
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset('../file-processor/src'), // TODO: Update path when Lambda code is ready
      handler: 'index.handler',
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(5), // Longer timeout for file processing
      memorySize: 512,
      environment: {
        SLACK_ARCHIVE_TABLE: this.slackArchiveTable.tableName,
        SLACK_FILES_BUCKET: this.slackFilesBucket.bucketName,
        // TODO: Add environment variables for secrets ARNs
      },
    });

    // TODO: Add DynamoDB stream event source mapping for file processor

    // Output important resources
    new cdk.CfnOutput(this, 'SlackArchiveTableName', {
      value: this.slackArchiveTable.tableName,
      description: 'DynamoDB table for Slack archive data',
    });

    new cdk.CfnOutput(this, 'SlackFilesBucketName', {
      value: this.slackFilesBucket.bucketName,
      description: 'S3 bucket for Slack files',
    });

    new cdk.CfnOutput(this, 'MessageListenerFunctionUrl', {
      value: messageListenerUrl.url,
      description: 'Function URL for Slack Events API webhook',
    });

    new cdk.CfnOutput(this, 'FileProcessorFunctionName', {
      value: this.fileProcessorFunction.functionName,
      description: 'Lambda function for processing file attachments',
    });
  }
}
