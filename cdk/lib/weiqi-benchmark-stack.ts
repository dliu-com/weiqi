import * as fs from 'fs';
import * as path from 'path';
import {Construct} from 'constructs';
import {Stack,StackProps,Duration,CfnOutput,RemovalPolicy,aws_s3 as s3,aws_lambda as lambda,aws_iam as iam,aws_logs as logs,aws_ec2 as ec2,aws_batch as batch,aws_ecr as ecr,aws_codebuild as codebuild,aws_sqs as sqs,aws_lambda_event_sources as sources} from 'aws-cdk-lib';
export class WeiqiBenchmarkStack extends Stack {
 constructor(scope:Construct,id:string,props:StackProps & {libraryBucket:string;engineAssetPath?:string;enableGpu?:boolean;analysisQueueArn?:string}) {
  super(scope,id,props);
  const root=path.join(__dirname,'../..'),bucket=s3.Bucket.fromBucketName(this,'Library',props.libraryBucket);
  const layer=new lambda.LayerVersion(this,'CpuEngine',{code:lambda.Code.fromAsset(props.engineAssetPath || path.join(root,'cloud/assets/cpu')),compatibleArchitectures:[lambda.Architecture.X86_64]});
  const cpu=new lambda.Function(this,'CpuAnalysis',{runtime:lambda.Runtime.PYTHON_3_12,architecture:lambda.Architecture.X86_64,code:lambda.Code.fromAsset(path.join(root,'cloud/worker')),handler:'worker.handler',layers:[layer],memorySize:3008,timeout:Duration.minutes(15),environment:{LIBRARY_BUCKET:bucket.bucketName,BACKEND:'cpu',SEARCH_THREADS:'2',APPIMAGE_EXTRACT_AND_RUN:'1'},logRetention:logs.RetentionDays.ONE_WEEK});
  bucket.grantRead(cpu,'models/*');bucket.grantWrite(cpu,'benchmarks/*');
  if(props.analysisQueueArn){
   const shared=['src/engine.js','src/sgf.js','src/analysis-status.js','backend/library-service.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
   const worker=fs.readFileSync(path.join(root,'scripts/analysis-worker.mjs'),'utf8');
   const analyse=worker.slice(worker.indexOf('export async function analyse'),worker.indexOf('export async function runLocalJob')).replace(/^export /gm,'');
   const handler=fs.readFileSync(path.join(root,'backend/cpu-worker.cjs'),'utf8');
   const liveCpu=new lambda.Function(this,'LibraryCpuWorker',{runtime:lambda.Runtime.NODEJS_22_X,architecture:lambda.Architecture.X86_64,code:lambda.Code.fromInline(shared+'\n'+analyse+'\n'+handler),handler:'index.handler',layers:[layer],memorySize:3008,timeout:Duration.minutes(15),environment:{LIBRARY_BUCKET:bucket.bucketName,KATAGO_MODEL_KEY:'models/g170e-b20c256x2-s5303129600-d1228401921.bin.gz',SECONDS_PER_POSITION:'1',APPIMAGE_EXTRACT_AND_RUN:'1'},logRetention:logs.RetentionDays.ONE_WEEK});
   bucket.grantRead(liveCpu,'models/*');bucket.grantReadWrite(liveCpu,'games/*');
   const queue=sqs.Queue.fromQueueArn(this,'AnalysisQueue',props.analysisQueueArn);
   liveCpu.addEventSource(new sources.SqsEventSource(queue,{batchSize:1,maxConcurrency:2,reportBatchItemFailures:true}));
   new CfnOutput(this,'LibraryCpuFunction',{value:liveCpu.functionName});
  }
  if(!props.enableGpu){new CfnOutput(this,'CpuFunctionName',{value:cpu.functionName});return;}
  const repository=new ecr.Repository(this,'GpuImage',{removalPolicy:RemovalPolicy.RETAIN,emptyOnDelete:false,lifecycleRules:[{maxImageCount:3}]});
  const vpc=new ec2.Vpc(this,'GpuNetwork',{maxAzs:2,natGateways:0,subnetConfiguration:[{name:'Public',subnetType:ec2.SubnetType.PUBLIC}]});
  const security=new ec2.SecurityGroup(this,'GpuSecurity',{vpc,allowAllOutbound:true});
  const instanceRole=new iam.Role(this,'GpuInstanceRole',{assumedBy:new iam.ServicePrincipal('ec2.amazonaws.com'),managedPolicies:[iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')]});
  const profile=new iam.CfnInstanceProfile(this,'GpuProfile',{roles:[instanceRole.roleName]});
  const spotRole=new iam.Role(this,'SpotFleetRole',{assumedBy:new iam.ServicePrincipal('spotfleet.amazonaws.com'),managedPolicies:[iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2SpotFleetTaggingRole')]});
  const launch=new ec2.CfnLaunchTemplate(this,'GpuLaunch',{launchTemplateData:{networkInterfaces:[{deviceIndex:0,associatePublicIpAddress:true,groups:[security.securityGroupId]}]}});
  const compute=new batch.CfnComputeEnvironment(this,'GpuCompute',{type:'MANAGED',state:'ENABLED',computeResources:{type:'SPOT',allocationStrategy:'SPOT_PRICE_CAPACITY_OPTIMIZED',minvCpus:0,maxvCpus:4,desiredvCpus:0,instanceTypes:['g4dn.xlarge'],instanceRole:profile.attrArn,spotIamFleetRole:spotRole.roleArn,subnets:vpc.publicSubnets.map(s=>s.subnetId),launchTemplate:{launchTemplateId:launch.ref,version:launch.attrLatestVersionNumber},ec2Configuration:[{imageType:'ECS_AL2023_NVIDIA'}]}});
  const queue=new batch.CfnJobQueue(this,'GpuQueue',{priority:1,state:'ENABLED',computeEnvironmentOrder:[{computeEnvironment:compute.ref,order:1}]});
  const jobRole=new iam.Role(this,'GpuJobRole',{assumedBy:new iam.ServicePrincipal('ecs-tasks.amazonaws.com')});bucket.grantRead(jobRole,'models/*');bucket.grantReadWrite(jobRole,'benchmarks/*');
  const log=new logs.LogGroup(this,'GpuLogs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY});
  const job=new batch.CfnJobDefinition(this,'GpuJob',{type:'container',platformCapabilities:['EC2'],retryStrategy:{attempts:1},timeout:{attemptDurationSeconds:900},containerProperties:{image:repository.repositoryUri+':benchmark',jobRoleArn:jobRole.roleArn,resourceRequirements:[{type:'VCPU',value:'4'},{type:'MEMORY',value:'10000'},{type:'GPU',value:'1'}],environment:[{name:'LIBRARY_BUCKET',value:bucket.bucketName}],logConfiguration:{logDriver:'awslogs',options:{'awslogs-group':log.logGroupName,'awslogs-region':this.region,'awslogs-stream-prefix':'benchmark'}}}});
  const build=new codebuild.Project(this,'GpuBuild',{source:codebuild.Source.s3({bucket,path:'build/gpu-source.zip'}),environment:{buildImage:codebuild.LinuxBuildImage.STANDARD_7_0,privileged:true,computeType:codebuild.ComputeType.SMALL},timeout:Duration.minutes(20),environmentVariables:{REPOSITORY_URI:{value:repository.repositoryUri}},buildSpec:codebuild.BuildSpec.fromObject({version:'0.2',phases:{pre_build:{commands:['aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "$REPOSITORY_URI"']},build:{commands:['docker build -f gpu/Dockerfile -t "$REPOSITORY_URI:benchmark" .']},post_build:{commands:['docker push "$REPOSITORY_URI:benchmark"']}}})});repository.grantPullPush(build);bucket.grantRead(build,'build/*');
  new CfnOutput(this,'CpuFunctionName',{value:cpu.functionName});new CfnOutput(this,'GpuJobQueue',{value:queue.ref});new CfnOutput(this,'GpuJobDefinition',{value:job.ref});new CfnOutput(this,'GpuBuildProject',{value:build.projectName});new CfnOutput(this,'GpuRepository',{value:repository.repositoryUri});new CfnOutput(this,'GpuComputeEnvironment',{value:compute.ref});
 }
}
