import * as path from 'path';
import {Construct} from 'constructs';
import {Stack,StackProps,Duration,CfnOutput,RemovalPolicy,aws_s3 as s3,aws_ec2 as ec2,aws_iam as iam,aws_batch as batch,aws_ecr as ecr,aws_codebuild as codebuild,aws_logs as logs} from 'aws-cdk-lib';

export class WeiqiGpuBenchmarkStack extends Stack {
 constructor(scope:Construct,id:string,props:StackProps & {libraryBucket:string}) {
  super(scope,id,props);
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
  for(const [name,type,limit] of [['T4','g4dn.xlarge',4],['A10G','g5.xlarge',4]] as const){
   const compute=new batch.CfnComputeEnvironment(this,name+'Compute',{type:'MANAGED',state:'ENABLED',replaceComputeEnvironment:false,computeResources:{type:'EC2',allocationStrategy:'BEST_FIT_PROGRESSIVE',minvCpus:0,maxvCpus:limit,scalingPolicy:{minScaleDownDelayMinutes:20},instanceTypes:[type],instanceRole:profile.attrArn,subnets:[...vpc.publicSubnets.map(s=>s.subnetId),capacitySubnet.ref],launchTemplate:{launchTemplateId:launch.ref,version:launch.attrLatestVersionNumber},ec2Configuration:[{imageType:'ECS_AL2023_NVIDIA'}],tags:{service:'weiqi-gpu-benchmark',benchmarkGpu:name}}});
   compute.node.addDependency(capacityRoute);
   const queue=new batch.CfnJobQueue(this,name+'Queue',{priority:1,state:'ENABLED',computeEnvironmentOrder:[{computeEnvironment:compute.ref,order:1}]});
   new CfnOutput(this,name+'QueueArn',{value:queue.ref});new CfnOutput(this,name+'ComputeArn',{value:compute.ref});
  }
  const jobRole=new iam.Role(this,'JobRole',{assumedBy:new iam.ServicePrincipal('ecs-tasks.amazonaws.com')});bucket.grantReadWrite(jobRole,'benchmarks/*');
  const log=new logs.LogGroup(this,'Logs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY});
  const job=new batch.CfnJobDefinition(this,'Job',{type:'container',platformCapabilities:['EC2'],retryStrategy:{attempts:1},timeout:{attemptDurationSeconds:3600},containerProperties:{image:repository.repositoryUri+':benchmark',jobRoleArn:jobRole.roleArn,resourceRequirements:[{type:'VCPU',value:'4'},{type:'MEMORY',value:'10000'},{type:'GPU',value:'1'}],environment:[{name:'LIBRARY_BUCKET',value:bucket.bucketName},{name:'ANALYSIS_TIMEOUT_SECONDS',value:'3500'}],logConfiguration:{logDriver:'awslogs',options:{'awslogs-group':log.logGroupName,'awslogs-region':this.region,'awslogs-stream-prefix':'benchmark'}}}});
  const build=new codebuild.Project(this,'Build',{source:codebuild.Source.s3({bucket,path:'build/gpu-source.zip'}),environment:{buildImage:codebuild.LinuxBuildImage.STANDARD_7_0,privileged:true,computeType:codebuild.ComputeType.SMALL},timeout:Duration.minutes(20),environmentVariables:{REPOSITORY_URI:{value:repository.repositoryUri}},buildSpec:codebuild.BuildSpec.fromObject({version:'0.2',phases:{pre_build:{commands:['aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "$REPOSITORY_URI"']},build:{commands:['docker build -f gpu/Dockerfile -t "$REPOSITORY_URI:benchmark" .']},post_build:{commands:['docker push "$REPOSITORY_URI:benchmark"']}}})});repository.grantPullPush(build);bucket.grantRead(build,'build/*');
  new CfnOutput(this,'JobDefinition',{value:job.ref});new CfnOutput(this,'BuildProject',{value:build.projectName});new CfnOutput(this,'Repository',{value:repository.repositoryUri});
 }
}
