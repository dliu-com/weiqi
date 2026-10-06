import {App} from 'aws-cdk-lib';import {Template,Match} from 'aws-cdk-lib/assertions';import {WeiqiBudgetStack} from '../lib/weiqi-budget-stack';
test('monthly budget filters project costs, has no email recipient and connects to a private stop guard',()=>{
 const t=Template.fromStack(new WeiqiBudgetStack(new App(),'BudgetTest',{libraryBucket:'fictional-library',jobQueues:['arn:aws:batch:eu-west-1:123456789012:job-queue/owned'],env:{account:'123456789012',region:'eu-west-1'}}));
 t.hasResourceProperties('AWS::Budgets::Budget',{Budget:Match.objectLike({BudgetLimit:{Amount:50,Unit:'USD'},TimeUnit:'MONTHLY',CostFilters:{TagKeyValue:['user:service$weiqi','user:service$weiqi-gpu-benchmark','user:service$weiqi-fargate','user:service$weiqi-benchmark']}}),NotificationsWithSubscribers:[{Notification:{ComparisonOperator:'GREATER_THAN',NotificationType:'ACTUAL',Threshold:50,ThresholdType:'ABSOLUTE_VALUE'},Subscribers:[{SubscriptionType:'SNS',Address:Match.anyValue()}]}]});
 t.resourceCountIs('AWS::Lambda::Url',0);expect(JSON.stringify(t.toJSON())).not.toContain('@dliu.com');t.hasResourceProperties('AWS::Events::Rule',{ScheduleExpression:'rate(5 minutes)'});
});
