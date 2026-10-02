# Weiqi · 围棋

A shared 19 × 19 Go board at https://weiqi.dliu.com. Chinese and English interface; first visit follows the browser language, with a remembered language switch.

## Play

Black plays first. Both players can use the same device or separate devices; there are no accounts or seat choices. The turn indicator identifies who plays next. The entire site shares one game, so anyone with the link can play, undo or restart it.

Captures, suicide prevention, positional superko, undo, resignation and restart are supported. Two consecutive passes begin Chinese area scoring (living stones plus territory, white komi 7.5 points, equivalent to 3¾ zi). Players mark dead groups, then both confirm. Captures are informational and do not add points. Resolve dead-group/seki disputes by agreement or resume play; this casual scorer does not adjudicate disputed life and death. The record is capped at 600 moves, with passes still available to finish.

Visible pages poll every five seconds. Automatic sync pauses after ten minutes without a move, and can be toggled. Every action fetches the latest position first; the server uses conditional revisions to prevent simultaneous overwrites. The focus view fits the board within the browser page.

## Deploy from a fresh clone

Prerequisites: Node.js 22 or newer, npm, Make, AWS CLI, and AWS credentials authorized to deploy CloudFormation/CDK resources. The existing core infrastructure must export `MainDomain` and `MainHostedZoneId` in `eu-west-1`, and the account/region must already be CDK-bootstrapped (as for Xiangqi).

```sh
git clone git@github.com:dliu-com/weiqi.git
cd weiqi
make
```

Plain `make` installs the locked CDK dependencies, runs game and infrastructure tests, deploys `WeiqiSite`, uploads static assets, and waits for CloudFront invalidation. It does not reset the stored game. `AWS_PROFILE=your-profile make` selects credentials.

```sh
make serve       # http://127.0.0.1:4174; separate in-memory local game
make install     # install CDK dependencies
make test        # game rules and infrastructure checks
make diff        # inspect AWS changes
make synth       # generate CloudFormation
make publish     # publish only static files
```

## Infrastructure and cost

Matches Xiangqi: private S3 static storage, pay-as-you-go CloudFront, ACM HTTPS certificate, existing Route 53 hosted-zone aliases, Lambda Function URL authenticated by CloudFront OAC, and a DynamoDB on-demand table. Lambda runs only on requests; no provisioned concurrency, SQL instance, load balancer, NAT gateway, VPC endpoint or new hosted zone is created.

Incremental fixed monthly service fees: **$0**, excluding existing domain/hosted-zone costs. Small storage charges are usage-based; at very little traffic the app should cost well below $1/month, although usage charges are not subject to a hard $1 cap. Seven-day log retention and expiration of old S3 versions limit accumulation. DynamoDB stores only the current shared game. S3 and DynamoDB are retained if the stack is deleted.

The browser sends only move commands; the backend validates rules. Game state is read consistently from DynamoDB and saved with revision checks. No AWS credentials appear in the static app. The public shared game has no user authentication.
