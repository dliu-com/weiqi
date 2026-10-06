import * as path from 'path';
import * as fs from 'fs';
import {Construct} from 'constructs';
import {Stack,StackProps,Duration,CfnOutput,RemovalPolicy,aws_s3 as s3,aws_ec2 as ec2,aws_iam as iam,aws_batch as batch,aws_ecr as ecr,aws_codebuild as codebuild,aws_logs as logs,aws_lambda as lambda,aws_sqs as sqs,aws_lambda_event_sources as sources,aws_events as events,aws_events_targets as targets} from 'aws-cdk-lib';

export class WeiqiGpuBenchmarkStack extends Stack {
 constructor(scope:Construct,id:string,props:StackProps & {libraryBucket:string;production?:boolean;dispatchEnabled?:boolean;analysisQueueArn?:string;cpuQuickQueue?:string;cpuDeepQueue?:string;cpuJobDefinition?:string}) {
  super(scope,id,props);
  const root=path.join(__dirname,'../..');
  const bucket=s3.Bucket.fromBucketName(this,'Library',props.libraryBucket);
  const repository=new ecr.Repository(this,'Image',{removalPolicy:RemovalPolicy.DESTROY,emptyOnDelete:true,lifecycleRules:[{maxImageCount:2}]});
  const vpc=new ec2.Vpc(this,'Network',{maxAzs:2,natGateways:0,subnetConfiguration:[{name:'Public',subnetType:ec2.SubnetType.PUBLIC}]});
  // Preserve the existing subnets. The original /16 is fully allocated, so
  // capacity in Ireland's third zone uses an additional VPC address range.
  const capacityRange=new ec2.CfnVPCCidrBlock(this,'CapacityRange',{vpcId:vpc.vpcId,cidrBlock:'10.1.0.0/16'});
  const capacitySubnet=new ec2.CfnSubnet(this,'CapacitySubnet',{vpcId:vpc.vpcId,cidrBlock:'10.1.0.0/24',availabilityZone:this.availabilityZones[2],mapPublicIpOnLaunch:true});
  capacitySubnet.addDependency(capacityRange);
  const capacityRoute=new ec2.CfnSubnetRouteTableAssociation(this,'CapacityRouting',{subnetId:capacitySubnet.ref,routeTableId:vpc.publicSubnets[0].routeTable.routeTableId});
  const security=new ec2.SecurityGroup(this,'Security',{vpc,allowAllOutbound:true});
  const instanceRole=new iam.Role(this,'InstanceRole',{assumedBy:new iam.ServicePrincipal('ec2.amazonaws.com'),managedPolicies:[iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')]});
  const profile=new iam.CfnInstanceProfile(this,'Profile',{roles:[instanceRole.roleName]});
  const launch=new ec2.CfnLaunchTemplate(this,'Launch',{launchTemplateData:{networkInterfaces:[{deviceIndex:0,associatePublicIpAddress:true,groups:[security.securityGroupId]}]}});
  // The account quota permits one four-vCPU GPU instance at a time. The runner
  // submits sequentially and releases each instance before trying the next type.
  let productionCompute:batch.CfnComputeEnvironment,productionQueue:batch.CfnJobQueue;
  const variants:readonly (readonly [string,string,number])[]=props.production?[['T4','g4dn.xlarge',4]]:[['T4','g4dn.xlarge',4],['A10G','g5.xlarge',4]];
  for(const [name,type,limit] of variants){
   const compute=new batch.CfnComputeEnvironment(this,name+'Compute',{type:'MANAGED',state:'ENABLED',replaceComputeEnvironment:false,computeResources:{type:'EC2',allocationStrategy:'BEST_FIT_PROGRESSIVE',minvCpus:0,maxvCpus:limit,scalingPolicy:{minScaleDownDelayMinutes:props.production?0:20},instanceTypes:[type],instanceRole:profile.attrArn,subnets:[...vpc.publicSubnets.map(s=>s.subnetId),capacitySubnet.ref],launchTemplate:{launchTemplateId:launch.ref,version:launch.attrLatestVersionNumber},ec2Configuration:[{imageType:'ECS_AL2023_NVIDIA'}],tags:{service:'weiqi-gpu-benchmark',benchmarkGpu:name}}});
   compute.node.addDependency(capacityRoute);
   const queue=new batch.CfnJobQueue(this,name+'Queue',{priority:name==='T4'&&props.production?100:1,state:'ENABLED',computeEnvironmentOrder:[{computeEnvironment:compute.ref,order:1}]});
   if(name==='T4'){productionCompute=compute;productionQueue=queue;}
   new CfnOutput(this,name+'QueueArn',{value:queue.ref});new CfnOutput(this,name+'ComputeArn',{value:compute.ref});
  }
  const jobRole=new iam.Role(this,'JobRole',{assumedBy:new iam.ServicePrincipal('ecs-tasks.amazonaws.com')});bucket.grantReadWrite(jobRole,'benchmarks/*');
  if(props.production){bucket.grantReadWrite(jobRole,'games/*');bucket.grantReadWrite(jobRole,'jobs/*');}
  const log=new logs.LogGroup(this,'Logs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY});
  const job=new batch.CfnJobDefinition(this,'Job',{type:'container',platformCapabilities:['EC2'],retryStrategy:{attempts:1},timeout:{attemptDurationSeconds:props.production?14400:3600},containerProperties:{image:repository.repositoryUri+':benchmark',jobRoleArn:jobRole.roleArn,resourceRequirements:[{type:'VCPU',value:'4'},{type:'MEMORY',value:'10000'},{type:'GPU',value:'1'}],environment:[{name:'LIBRARY_BUCKET',value:bucket.bucketName},{name:'ANALYSIS_TIMEOUT_SECONDS',value:props.production?'14300':'3500'}],logConfiguration:{logDriver:'awslogs',options:{'awslogs-group':log.logGroupName,'awslogs-region':this.region,'awslogs-stream-prefix':'benchmark'}}}});
  const build=new codebuild.Project(this,'Build',{source:codebuild.Source.s3({bucket,path:'build/gpu-source.zip'}),environment:{buildImage:codebuild.LinuxBuildImage.STANDARD_7_0,privileged:true,computeType:codebuild.ComputeType.SMALL},timeout:Duration.minutes(20),environmentVariables:{REPOSITORY_URI:{value:repository.repositoryUri}},buildSpec:codebuild.BuildSpec.fromObject({version:'0.2',phases:{pre_build:{commands:['aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "$REPOSITORY_URI"']},build:{commands:['docker build -f gpu/Dockerfile -t "$REPOSITORY_URI:benchmark" .']},post_build:{commands:['docker push "$REPOSITORY_URI:benchmark"']}}})});repository.grantPullPush(build);bucket.grantRead(build,'build/*');
  if(props.production){
   if(!props.analysisQueueArn||!props.cpuQuickQueue||!props.cpuDeepQueue||!props.cpuJobDefinition)throw Error('GPU production requires the upload queue and CPU fallback queues/job definition.');
   const uploads=new sqs.Queue(this,'ProductionUploads',{visibilityTimeout:Duration.minutes(3),retentionPeriod:Duration.days(14)});
   const deep=new batch.CfnJobQueue(this,'ProductionDeepQueue',{priority:1,state:'ENABLED',computeEnvironmentOrder:[{computeEnvironment:productionCompute!.ref,order:1}]});
   const dead=new sqs.Queue(this,'FallbackDeadLetters',{retentionPeriod:Duration.days(7)});
   const fallbackQueue=new sqs.Queue(this,'FallbackQueue',{visibilityTimeout:Duration.seconds(60),retentionPeriod:Duration.days(1),deadLetterQueue:{queue:dead,maxReceiveCount:4}});
   const fallback=new lambda.Function(this,'CapacityFallback',{runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',code:lambda.Code.fromInline(fs.readFileSync(path.join(root,'backend/gpu-fallback.cjs'),'utf8')),timeout:Duration.seconds(30),memorySize:256,environment:{LIBRARY_BUCKET:bucket.bucketName,CPU_QUICK_QUEUE:props.cpuQuickQueue,CPU_DEEP_QUEUE:props.cpuDeepQueue,CPU_JOB_DEFINITION:props.cpuJobDefinition,FALLBACK_QUEUE:fallbackQueue.queueUrl,GPU_FALLBACK_WAIT_SECONDS:'1200'},logRetention:logs.RetentionDays.ONE_WEEK});
   bucket.grantReadWrite(fallback,'games/*');bucket.grantReadWrite(fallback,'jobs/*');
   fallback.addToRolePolicy(new iam.PolicyStatement({actions:['batch:DescribeJobs','batch:ListJobs','batch:CancelJob'],resources:['*']}));
   fallback.addToRolePolicy(new iam.PolicyStatement({actions:['batch:SubmitJob'],resources:[props.cpuQuickQueue,props.cpuDeepQueue,props.cpuJobDefinition]}));
   fallbackQueue.grantSendMessages(fallback);
   fallback.addEventSource(new sources.SqsEventSource(fallbackQueue,{batchSize:1,maxConcurrency:2,reportBatchItemFailures:true}));
   const shared=['src/engine.js','src/sgf.js','backend/library-service.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
   const modelResolver=fs.readFileSync(path.join(root,'backend/katago-model.cjs'),'utf8').replace(/^module.exports=.*;$/gm,'');
   const dispatcher=new lambda.Function(this,'ProductionDispatcher',{runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',code:lambda.Code.fromInline(shared+'\n'+modelResolver+'\n'+fs.readFileSync(path.join(root,'backend/fargate-dispatcher.cjs'),'utf8')),timeout:Duration.seconds(30),memorySize:256,environment:{LIBRARY_BUCKET:bucket.bucketName,JOB_QUEUE:props.cpuQuickQueue,DEEP_QUEUE:deep.ref,JOB_DEFINITION:job.ref,CPU_JOB_DEFINITION:props.cpuJobDefinition,ANALYSIS_BACKEND:'gpu',FALLBACK_QUEUE:fallbackQueue.queueUrl,GPU_ANALYSIS_THREADS:'16',GPU_MAX_BATCH_SIZE:'32',GPU_FALLBACK_WAIT_SECONDS:'1200'},logRetention:logs.RetentionDays.ONE_WEEK});
   bucket.grantReadWrite(dispatcher,'games/*');bucket.grantWrite(dispatcher,'jobs/*');fallbackQueue.grantSendMessages(dispatcher);
   dispatcher.addToRolePolicy(new iam.PolicyStatement({actions:['batch:SubmitJob'],resources:[props.cpuQuickQueue,props.cpuJobDefinition,deep.ref,job.ref]}));
   dispatcher.addEventSource(new sources.SqsEventSource(uploads,{batchSize:1,maxConcurrency:2,reportBatchItemFailures:true,enabled:props.dispatchEnabled!==false}));
   const failure=new lambda.Function(this,'FailureStatus',{runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',code:lambda.Code.fromInline(fs.readFileSync(path.join(root,'backend/fargate-status.cjs'),'utf8')),timeout:Duration.seconds(15),environment:{LIBRARY_BUCKET:bucket.bucketName},logRetention:logs.RetentionDays.ONE_WEEK});
   bucket.grantReadWrite(failure,'games/*');
   new events.Rule(this,'ProductionJobFailure',{eventPattern:{source:['aws.batch'],detailType:['Batch Job State Change'],detail:{status:['FAILED'],jobQueue:[productionQueue!.ref,deep.ref]}},targets:[new targets.LambdaFunction(failure)]});
   new CfnOutput(this,'ProductionUploadQueueArn',{value:uploads.queueArn});new CfnOutput(this,'ProductionUploadQueueUrl',{value:uploads.queueUrl});
   new CfnOutput(this,'ProductionDispatcherName',{value:dispatcher.functionName});
   new CfnOutput(this,'ProductionDeepQueueArn',{value:deep.ref});
  }
  new CfnOutput(this,'JobDefinition',{value:job.ref});new CfnOutput(this,'BuildProject',{value:build.projectName});new CfnOutput(this,'Repository',{value:repository.repositoryUri});
 }
}
