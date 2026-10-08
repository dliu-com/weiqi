import * as path from 'path';
import * as fs from 'fs';
import {createHash} from 'node:crypto';
import {projectConfig} from './project-config';
import {Construct} from 'constructs';
import {Stack,StackProps,Duration,CfnOutput,RemovalPolicy,custom_resources as cr,aws_s3 as s3,aws_ec2 as ec2,aws_iam as iam,aws_batch as batch,aws_ecr as ecr,aws_codebuild as codebuild,aws_logs as logs,aws_lambda as lambda,aws_sqs as sqs,aws_lambda_event_sources as sources,aws_events as events,aws_events_targets as targets} from 'aws-cdk-lib';

export class WeiqiGpuBenchmarkStack extends Stack {
 readonly productionJobQueues:string[]=[];
 constructor(scope:Construct,id:string,props:StackProps & {libraryBucket:string;production?:boolean;dispatchEnabled?:boolean;analysisQueueArn?:string;cpuQuickQueue?:string;cpuDeepQueue?:string;cpuJobDefinition?:string}) {
  super(scope,id,props);
  const root=path.join(__dirname,'../..');
  const customResourceLogs=new logs.LogGroup(this,'CustomResourceLogs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY});
  const tagBatch=(name:string,arn:string)=>new cr.AwsCustomResource(this,name+'ProjectTag',{logGroup:customResourceLogs,
   onCreate:{service:'Batch',action:'tagResource',parameters:{resourceArn:arn,tags:{[projectConfig.project.tagKey]:projectConfig.project.tagValue}},physicalResourceId:cr.PhysicalResourceId.of(name+'-project-tag')},
   onUpdate:{service:'Batch',action:'tagResource',parameters:{resourceArn:arn,tags:{[projectConfig.project.tagKey]:projectConfig.project.tagValue}},physicalResourceId:cr.PhysicalResourceId.of(name+'-project-tag')},
   policy:cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({actions:['batch:TagResource'],resources:[arn]})]),installLatestAwsSdk:false,
  });
  const workerTag='worker-'+createHash('sha256').update(fs.readFileSync(path.join(root,'cloud/worker/worker.py'))).digest('hex').slice(0,12);
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
  const launch=new ec2.CfnLaunchTemplate(this,'Launch',{launchTemplateData:{networkInterfaces:[{deviceIndex:0,associatePublicIpAddress:true,groups:[security.securityGroupId]}],tagSpecifications:[{resourceType:'instance',tags:[{key:projectConfig.project.tagKey,value:projectConfig.project.tagValue},{key:'service',value:'weiqi-gpu-benchmark'}]},{resourceType:'volume',tags:[{key:projectConfig.project.tagKey,value:projectConfig.project.tagValue},{key:'service',value:'weiqi-gpu-benchmark'}]}]}});
  // Ireland's approved eight-vCPU G/VT quota permits two production T4 workers.
  // Benchmark environments retain a one-instance limit for controlled comparisons.
  let productionCompute:batch.CfnComputeEnvironment,productionQueue:batch.CfnJobQueue,fallbackGpuQueue:batch.CfnJobQueue,spotQueue:batch.CfnJobQueue;
  const variants:readonly (readonly [string,string,number])[]=props.production?[['T4','g4dn.xlarge',8],['A10G','g5.xlarge',4]]:[['T4','g4dn.xlarge',4],['A10G','g5.xlarge',4]];
  for(const [name,type,limit] of variants){
   const compute=new batch.CfnComputeEnvironment(this,name+'Compute',{type:'MANAGED',state:'ENABLED',replaceComputeEnvironment:false,computeResources:{type:'EC2',allocationStrategy:'BEST_FIT_PROGRESSIVE',minvCpus:0,maxvCpus:limit,scalingPolicy:{minScaleDownDelayMinutes:props.production?0:20},instanceTypes:[type],instanceRole:profile.attrArn,subnets:[...vpc.publicSubnets.map(s=>s.subnetId),capacitySubnet.ref],launchTemplate:{launchTemplateId:launch.ref,version:launch.attrLatestVersionNumber},ec2Configuration:[{imageType:'ECS_AL2023_NVIDIA'}],tags:{[projectConfig.project.tagKey]:projectConfig.project.tagValue,service:'weiqi-gpu-benchmark',benchmarkGpu:name}}});
   compute.node.addDependency(capacityRoute);
   const queue=new batch.CfnJobQueue(this,name+'Queue',{priority:name==='T4'&&props.production?100:1,state:'ENABLED',computeEnvironmentOrder:[{computeEnvironment:compute.ref,order:1}]});
   tagBatch(name+'Compute',compute.ref);tagBatch(name+'Queue',queue.ref);
   if(name==='T4'){productionCompute=compute;productionQueue=queue;}if(name==='A10G')fallbackGpuQueue=queue;
   new CfnOutput(this,name+'QueueArn',{value:queue.ref});new CfnOutput(this,name+'ComputeArn',{value:compute.ref});
  }
  if(props.production){
   const spotRole=new iam.Role(this,'SpotFleetRole',{assumedBy:new iam.ServicePrincipal('spotfleet.amazonaws.com'),managedPolicies:[iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2SpotFleetTaggingRole')]});
   const spot=new batch.CfnComputeEnvironment(this,'A10GSpotCompute',{type:'MANAGED',state:'ENABLED',replaceComputeEnvironment:false,computeResources:{type:'SPOT',allocationStrategy:'SPOT_CAPACITY_OPTIMIZED',minvCpus:0,maxvCpus:4,scalingPolicy:{minScaleDownDelayMinutes:0},instanceTypes:['g4dn.xlarge','g5.xlarge'],instanceRole:profile.attrArn,spotIamFleetRole:spotRole.roleArn,subnets:[...vpc.publicSubnets.map(s=>s.subnetId),capacitySubnet.ref],launchTemplate:{launchTemplateId:launch.ref,version:launch.attrLatestVersionNumber},ec2Configuration:[{imageType:'ECS_AL2023_NVIDIA'}],tags:{[projectConfig.project.tagKey]:projectConfig.project.tagValue,service:'weiqi-gpu-benchmark',benchmarkGpu:'A10G'}}});
   spot.node.addDependency(capacityRoute);
   spotQueue=new batch.CfnJobQueue(this,'GpuSpotQueue',{priority:1,state:'ENABLED',computeEnvironmentOrder:[{computeEnvironment:spot.ref,order:1}]});
   tagBatch('SpotCompute',spot.ref);tagBatch('SpotQueue',spotQueue.ref);
   new CfnOutput(this,'FallbackSpotComputeArn',{value:spot.ref});
  }
  const jobRole=new iam.Role(this,'JobRole',{assumedBy:new iam.ServicePrincipal('ecs-tasks.amazonaws.com')});bucket.grantReadWrite(jobRole,'benchmarks/*');
  if(props.production){bucket.grantReadWrite(jobRole,'games/*');bucket.grantReadWrite(jobRole,'jobs/*');}
  const log=new logs.LogGroup(this,'Logs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY});
  const job=new batch.CfnJobDefinition(this,'Job',{type:'container',platformCapabilities:['EC2'],retryStrategy:{attempts:1},timeout:{attemptDurationSeconds:props.production?projectConfig.analysis.jobTimeoutSeconds:3600},containerProperties:{image:repository.repositoryUri+':'+workerTag,jobRoleArn:jobRole.roleArn,resourceRequirements:[{type:'VCPU',value:'4'},{type:'MEMORY',value:'10000'},{type:'GPU',value:'1'}],environment:[{name:'LIBRARY_BUCKET',value:bucket.bucketName},{name:'ANALYSIS_TIMEOUT_SECONDS',value:props.production?String(projectConfig.analysis.jobTimeoutSeconds-100):'3500'},{name:'MAX_VISITS',value:String(projectConfig.analysis.deepVisits)}],logConfiguration:{logDriver:'awslogs',options:{'awslogs-group':log.logGroupName,'awslogs-region':this.region,'awslogs-stream-prefix':'benchmark'}}}});
  const build=new codebuild.Project(this,'Build',{source:codebuild.Source.s3({bucket,path:'build/gpu-source.zip'}),environment:{buildImage:codebuild.LinuxBuildImage.STANDARD_7_0,privileged:true,computeType:codebuild.ComputeType.SMALL},timeout:Duration.minutes(20),environmentVariables:{REPOSITORY_URI:{value:repository.repositoryUri},IMAGE_TAG:{value:workerTag}},buildSpec:codebuild.BuildSpec.fromObject({version:'0.2',phases:{pre_build:{commands:['aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "$REPOSITORY_URI"']},build:{commands:['docker build -f gpu/Dockerfile -t "$REPOSITORY_URI:$IMAGE_TAG" .']},post_build:{commands:['docker push "$REPOSITORY_URI:$IMAGE_TAG"']}}})});repository.grantPullPush(build);bucket.grantRead(build,'build/*');
  if(props.production){
   const uploads=new sqs.Queue(this,'ProductionUploads',{visibilityTimeout:Duration.minutes(3),retentionPeriod:Duration.days(14)});
   const dead=new sqs.Queue(this,'FallbackDeadLetters',{retentionPeriod:Duration.days(7)});
   const fallbackQueue=new sqs.Queue(this,'FallbackQueue',{visibilityTimeout:Duration.seconds(60),retentionPeriod:Duration.days(1),deadLetterQueue:{queue:dead,maxReceiveCount:4}});
   const shared=['src/engine.js','src/sgf.js','backend/library-service.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
   const modelResolver=fs.readFileSync(path.join(root,'backend/katago-model.cjs'),'utf8').replace(/^module.exports=.*;$/gm,'');
   const code=lambda.Code.fromInline(shared+'\n'+modelResolver+'\n'+fs.readFileSync(path.join(root,'backend/gpu-production.cjs'),'utf8'));
   const gpuQueues=[productionQueue!.ref,fallbackGpuQueue!.ref,spotQueue!.ref];this.productionJobQueues.push(...gpuQueues);
   const environment={LIBRARY_BUCKET:bucket.bucketName,AI_CONTROL_KEY:'control/ai-spending.json',JOB_QUEUE:productionQueue!.ref,FALLBACK_GPU_QUEUE:fallbackGpuQueue!.ref,FALLBACK_SPOT_QUEUE:spotQueue!.ref,JOB_DEFINITION:job.ref,CONTROL_QUEUE:fallbackQueue.queueUrl,GPU_FALLBACK_WAIT_SECONDS:String(projectConfig.analysis.capacityFallbackSeconds),QUICK_VISITS:String(projectConfig.analysis.quickVisits),DEEP_VISITS:String(projectConfig.analysis.deepVisits)};
   const createCoordinator=(name:string)=>{
    const fn=new lambda.Function(this,name,{runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',code,timeout:Duration.seconds(30),memorySize:256,environment,logGroup:new logs.LogGroup(this,name+'Logs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY})});
    bucket.grantReadWrite(fn,'games/*');bucket.grantReadWrite(fn,'jobs/*');bucket.grantRead(fn,'control/ai-spending.json');fallbackQueue.grantSendMessages(fn);
    fn.addToRolePolicy(new iam.PolicyStatement({actions:['batch:DescribeJobs','batch:ListJobs','batch:CancelJob'],resources:['*']}));
    fn.addToRolePolicy(new iam.PolicyStatement({actions:['batch:SubmitJob'],resources:[...gpuQueues,job.ref]}));return fn;
   };
   const dispatcher=createCoordinator('ProductionDispatcher');
   dispatcher.addEventSource(new sources.SqsEventSource(uploads,{batchSize:1,maxConcurrency:2,reportBatchItemFailures:true,enabled:props.dispatchEnabled!==false}));
   const fallback=createCoordinator('CapacityFallback');
   fallback.addEventSource(new sources.SqsEventSource(fallbackQueue,{batchSize:1,maxConcurrency:2,reportBatchItemFailures:true}));
   const failure=createCoordinator('FailureStatus');
   new events.Rule(this,'ProductionJobFailure',{eventPattern:{source:['aws.batch'],detailType:['Batch Job State Change'],detail:{status:['FAILED'],jobQueue:gpuQueues}},targets:[new targets.LambdaFunction(failure,{deadLetterQueue:dead})]});
   new CfnOutput(this,'ProductionUploadQueueArn',{value:uploads.queueArn});new CfnOutput(this,'ProductionUploadQueueUrl',{value:uploads.queueUrl});
   new CfnOutput(this,'ProductionDispatcherName',{value:dispatcher.functionName});
   new CfnOutput(this,'ProductionDeepQueueArn',{value:productionQueue!.ref});
   new CfnOutput(this,'FailureStatusName',{value:failure.functionName});
   new CfnOutput(this,'CapacityFallbackName',{value:fallback.functionName});
  }
  new CfnOutput(this,'JobDefinition',{value:job.ref});new CfnOutput(this,'BuildProject',{value:build.projectName});new CfnOutput(this,'Repository',{value:repository.repositoryUri});
 }
}
