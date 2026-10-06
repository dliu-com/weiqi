import {Construct} from 'constructs';
import {Stack,StackProps,RemovalPolicy,Duration,CfnOutput,CfnWaitConditionHandle,aws_s3 as s3,aws_dynamodb as dynamodb} from 'aws-cdk-lib';
export class WeiqiStorageStack extends Stack {
 readonly gameTable:dynamodb.Table;
 readonly libraryBucket:s3.Bucket;
 constructor(scope:Construct,id:string,props:StackProps){
  super(scope,id,props);
  new CfnWaitConditionHandle(this,'StorageAnchor');
    this.gameTable = new dynamodb.Table(this, 'GameState', {
      partitionKey: { name: 'gameId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      deletionProtection:true,pointInTimeRecoverySpecification:{pointInTimeRecoveryEnabled:true},
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.libraryBucket = new s3.Bucket(this, 'RecordLibrary', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption:s3.BucketEncryption.S3_MANAGED,
      enforceSSL:true, removalPolicy:RemovalPolicy.RETAIN, versioned:true,
      lifecycleRules:[{noncurrentVersionExpiration:Duration.days(30),abortIncompleteMultipartUploadAfter:Duration.days(1)}],
    });

  new CfnOutput(this,'LibraryBucketName',{value:this.libraryBucket.bucketName});
  new CfnOutput(this,'GameTableName',{value:this.gameTable.tableName});
 }
}
