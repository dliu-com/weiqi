import {Construct} from 'constructs';
import {Stack,StackProps,Duration,RemovalPolicy,CfnOutput,aws_s3 as s3,aws_lambda as lambda,aws_dynamodb as dynamodb,aws_logs as logs} from 'aws-cdk-lib';
import {projectConfig} from './project-config';
export class WeiqiPositionStack extends Stack{
 constructor(scope:Construct,id:string,props:StackProps&{libraryBucket:string;release:{recognitionKey:string;aiKey:string}}){
  super(scope,id,props);const bucket=s3.Bucket.fromBucketName(this,'CodeBucket',props.libraryBucket),config=projectConfig.positionAnalysis;
  const usage=new dynamodb.Table(this,'Usage',{tableName:'weiqi-position-usage',partitionKey:{name:'id',type:dynamodb.AttributeType.STRING},billingMode:dynamodb.BillingMode.PAY_PER_REQUEST,timeToLiveAttribute:'expires',removalPolicy:RemovalPolicy.RETAIN});
  for(const [name,handler,key,memory,timeout,environment] of [
   ['Recognition','recognize.handler',props.release.recognitionKey,config.recognitionMemoryMb,config.recognitionTimeoutSeconds,{MODEL_PATH:'/var/task/model.onnx',THREADS:'1'}],
   ['Engine','analyze.handler',props.release.aiKey,config.aiMemoryMb,config.aiTimeoutSeconds,{VISITS:String(config.aiVisits),APPIMAGE_EXTRACT_AND_RUN:'1'}],
  ] as const){
   const fn=new lambda.Function(this,name,{functionName:'WeiqiPosition'+name,runtime:lambda.Runtime.PYTHON_3_12,architecture:lambda.Architecture.X86_64,handler,code:lambda.Code.fromBucket(bucket,key),memorySize:memory,timeout:Duration.seconds(timeout),environment:environment as Record<string,string>,logGroup:new logs.LogGroup(this,name+'Logs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY})});
   new CfnOutput(this,name+'Name',{value:fn.functionName});
  }
  new CfnOutput(this,'UsageTableName',{value:usage.tableName});
 }
}
