import {Construct} from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
import {Stack,StackProps,Duration,CfnOutput,RemovalPolicy,aws_s3 as s3,aws_iam as iam,aws_lambda as lambda,aws_logs as logs,aws_sns as sns,aws_sns_subscriptions as subscriptions,aws_budgets as budgets,aws_events as events,aws_events_targets as targets,custom_resources as cr} from 'aws-cdk-lib';
import {projectConfig} from './project-config';
export class WeiqiBudgetStack extends Stack{
 constructor(scope:Construct,id:string,props:StackProps&{libraryBucket:string;jobQueues:string[]}){
  super(scope,id,props);
  const topic=new sns.Topic(this,'BudgetAlerts');
  const budgetName='Weiqi-monthly-spending',dailyNames=['Weiqi-daily-project-spending','Weiqi-daily-service-spending'];
  const topicPolicy=new sns.TopicPolicy(this,'BudgetTopicPolicy',{topics:[topic]});
  topicPolicy.document.addStatements(new iam.PolicyStatement({principals:[new iam.ServicePrincipal('budgets.amazonaws.com')],actions:['sns:Publish'],resources:[topic.topicArn],conditions:{StringEquals:{'aws:SourceAccount':this.account},ArnEquals:{'aws:SourceArn':[budgetName,...dailyNames].map(n=>`arn:${this.partition}:budgets::${this.account}:budget/${n}`)}}}));
  // Reuse the existing service key so billing need not wait for discovery of
  // a new tag key. Legacy Weiqi worker values stay inside the same budget.
  const activation=new cr.AwsCustomResource(this,'ActivateBillingTag',{
   logGroup:new logs.LogGroup(this,'CustomResourceLogs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY}),
   onCreate:{service:'CostExplorer',action:'updateCostAllocationTagsStatus',parameters:{CostAllocationTagsStatus:[{TagKey:'service',Status:'Active'}]},physicalResourceId:cr.PhysicalResourceId.of('Weiqi-service-billing-tag')},
   onUpdate:{service:'CostExplorer',action:'updateCostAllocationTagsStatus',parameters:{CostAllocationTagsStatus:[{TagKey:'service',Status:'Active'}]},physicalResourceId:cr.PhysicalResourceId.of('Weiqi-service-billing-tag')},
   policy:cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({actions:['ce:UpdateCostAllocationTagsStatus'],resources:['*']})]),installLatestAwsSdk:false,
  });
  const budget=new budgets.CfnBudget(this,'MonthlyBudget',{
   budget:{budgetName,budgetType:'COST',timeUnit:'MONTHLY',budgetLimit:{amount:projectConfig.budget.monthlyUsd,unit:'USD'},costFilters:{TagKeyValue:['user:service$weiqi','user:service$weiqi-gpu-benchmark','user:service$weiqi-fargate','user:service$weiqi-benchmark']},costTypes:{includeCredit:false,includeRefund:false,includeTax:true,useBlended:false}},
   notificationsWithSubscribers:[{notification:{notificationType:'ACTUAL',comparisonOperator:'GREATER_THAN',thresholdType:'ABSOLUTE_VALUE',threshold:projectConfig.budget.monthlyUsd},subscribers:[{subscriptionType:'SNS',address:topic.topicArn}]}],
  });
  budget.node.addDependency(activation);budget.node.addDependency(topicPolicy);
  // Project is the intended scope. The active legacy service tag covers the same
  // stacks while AWS discovers/activates Project for cost allocation.
  for(const [i,name] of dailyNames.entries()){
   const daily=new budgets.CfnBudget(this,'DailyBudget'+i,{budget:{budgetName:name,budgetType:'COST',timeUnit:'DAILY',budgetLimit:{amount:projectConfig.budget.dailyUsd,unit:'USD'},costFilters:{TagKeyValue:i===0?[`user:${projectConfig.project.tagKey}$${projectConfig.project.tagValue}`]:['user:service$weiqi','user:service$weiqi-gpu-benchmark','user:service$weiqi-fargate','user:service$weiqi-benchmark']},costTypes:{includeCredit:false,includeRefund:false,includeTax:true,useBlended:false}},notificationsWithSubscribers:[{notification:{notificationType:'ACTUAL',comparisonOperator:'GREATER_THAN',thresholdType:'ABSOLUTE_VALUE',threshold:projectConfig.budget.dailyUsd},subscribers:[{subscriptionType:'SNS',address:topic.topicArn}]}]});daily.node.addDependency(topicPolicy);
  }
  const bucket=s3.Bucket.fromBucketName(this,'Library',props.libraryBucket);
  const guard=new lambda.Function(this,'SpendingGuard',{runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',code:lambda.Code.fromInline(fs.readFileSync(path.join(__dirname,'../../backend/budget-guard.cjs'),'utf8')),timeout:Duration.minutes(1),memorySize:256,logGroup:new logs.LogGroup(this,'SpendingGuardLogs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY}),environment:{LIBRARY_BUCKET:bucket.bucketName,AI_CONTROL_KEY:'control/ai-spending.json',JOB_QUEUES:JSON.stringify(props.jobQueues),BUDGET_TOPIC_ARN:topic.topicArn,ACCOUNT_ID:this.account,BUDGET_NAME:budgetName,MONTHLY_USD:String(projectConfig.budget.monthlyUsd),DAILY_USD:String(projectConfig.budget.dailyUsd),DAILY_BUDGET_NAMES:JSON.stringify(dailyNames),PROJECT_TAG_KEY:projectConfig.project.tagKey}});
  bucket.grantReadWrite(guard,'control/ai-spending.json');bucket.grantReadWrite(guard,'games/*/metadata.json');
  if(props.jobQueues.length)guard.addToRolePolicy(new iam.PolicyStatement({actions:['batch:UpdateJobQueue'],resources:props.jobQueues}));
  guard.addToRolePolicy(new iam.PolicyStatement({actions:['batch:ListJobs'],resources:['*']}));
  guard.addToRolePolicy(new iam.PolicyStatement({actions:['batch:TerminateJob'],resources:[`arn:${this.partition}:batch:${this.region}:${this.account}:job/*`]}));
  guard.addToRolePolicy(new iam.PolicyStatement({actions:['budgets:ViewBudget'],resources:[budgetName,...dailyNames].map(n=>`arn:${this.partition}:budgets::${this.account}:budget/${n}`)}));
  guard.addToRolePolicy(new iam.PolicyStatement({actions:['ce:UpdateCostAllocationTagsStatus'],resources:['*']}));
  topic.addSubscription(new subscriptions.LambdaSubscription(guard));
  // An idempotent sweep catches in-flight submission/start races and a missed
  // termination. While unpaused this only reads one tiny private S3 object.
  new events.Rule(this,'ReconcilePause',{schedule:events.Schedule.rate(Duration.minutes(5)),targets:[new targets.LambdaFunction(guard,{retryAttempts:2})]});
  new CfnOutput(this,'BudgetName',{value:budgetName});new CfnOutput(this,'DailyBudgetNames',{value:JSON.stringify(dailyNames)});new CfnOutput(this,'SpendingGuardName',{value:guard.functionName});new CfnOutput(this,'BudgetTopicArn',{value:topic.topicArn});
 }
}
