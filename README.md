# Weiqi · 围棋

A shared 19 × 19 Go board at https://weiqi.dliu.com. Chinese and English interface; first visit follows the browser language, with a remembered language switch.

## Play

Black plays first. Both players can use the same device or separate devices; there are no accounts or seat choices. The turn indicator identifies who plays next. The entire site shares one game, so anyone with the link can play, undo or restart it.

Captures, suicide prevention, positional superko, undo, resignation and restart are supported. Two consecutive passes begin Chinese area scoring (living stones plus territory, white komi 7.5 points, equivalent to 3¾ zi). Players mark all dead groups, confirm to preview the winner, then confirm the result to finish. Captures are informational and do not add points. Resolve dead-group/seki disputes by agreement or resume play; this casual scorer does not adjudicate disputed life and death. The record is capped at 600 moves, with passes still available to finish.

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

Incremental fixed monthly service fees: **$0**, excluding existing domain/hosted-zone costs. Small storage charges are usage-based; at very little traffic the app should cost well below $1/month, although usage charges are not subject to a hard $1 cap. Seven-day log retention and expiration of old S3 versions limit accumulation. DynamoDB stores the current shared game and archived games; archive storage grows with use. S3 and DynamoDB are retained if the stack is deleted.

The browser sends only move commands; the backend validates rules. Game state is read consistently from DynamoDB and saved with revision checks. No AWS credentials appear in the static app. The public shared game has no user authentication.


## Review, metadata, clocks and SGF

Undo removes the withdrawn move from the saved move tree and SGF export. Reviewing a node supports temporary local trial moves, with undo and clear controls. Trial moves are never saved or exported. Selecting another node or Return to live discards them; live sync continues while reviewing. Starting a new game atomically archives the previous game. Game history is available at /history.html; archived game records cannot be played on, but local trial moves are available from a review node and game/player names can be edited. Default game labels use date/time.

Move timestamps and player clock totals are recorded from this version onward. Legacy move timestamps cannot be recovered. Timing starts after the first move, uses visible-page heartbeats every five seconds, and can be paused/resumed. After one minute without a heartbeat from any device it automatically pauses, excluding time after the last heartbeat; returning resumes automatically unless manually paused. There is no scheduled background service. Disabling auto-sync also stops that device’s heartbeats. Scoring stops the clock. Undo does not refund elapsed thinking time. Both clients display the same server-maintained totals; device clock accuracy affects the live ticking display.

Download SGF exports the complete tree, player names, game name, result, and timing comments in UTF-8 SGF FF[4]. [Format reference](https://www.red-bean.com/sgf/sgf4.html). Timing is elapsed time, not a countdown; standard time-left properties are intentionally not used.

This remains a public shared app. Game metadata/history is stored in DynamoDB, never committed to this repository. Tests use fictional names and isolated in-memory records. Do not commit production game exports, credentials, or deployment output.

The bilingual rules and controls guide is available at /rules.html. It is static and sends no game API requests.


## Portable SGF library and local KataGo development

The library lists the newest 10 records per page, with Previous/Next navigation. A reverse-timestamp `library-index/` of small S3 JSON files supports bounded newest-first reads; entries point to authoritative game metadata. Rebuild the index from existing files with `node scripts/rebuild-library-index.mjs <bucket>`.

`/library.html` accepts a single UTF-8 19 × 19 Go SGF (up to 256 KB, 2,000 SGF nodes). Each record receives a permanent `/record/<game-id>` link. Replay is immediate, even while analysis is queued/running. The viewer checks for quick results every 15 seconds, pauses while hidden and stops automatic checking when quick results arrive or fail. Deeper results are checked only on a manual page refresh. A spinner shows remaining processing time and an estimated completion timestamp with UTC offset and browser time zone. Queued jobs show an earliest estimate because queue time is extra. The countdown updates locally; it does not poll deep results. Quick results appear automatically without starting another job. A page refresh selects completed deep results. The viewer shows point advantage and Black win rate, a clickable, draggable Black/White graph with Score and Win % modes, keyboard navigation, ±10-move jumps, autoplay and unsaved trial moves. SGF variations can be reviewed; analysis covers the main line only. Setup changes after the initial position and non-UTF-8 encodings are rejected with an error. The original file is preserved for download, including properties the viewer does not display.

A dedicated private, encrypted, retained S3 bucket stores:

```text
games/<game-id>/original.sgf
games/<game-id>/metadata.json
games/<game-id>/analysis-quick.json
games/<game-id>/analysis.json
```

Metadata is also stored in files, so copying the bucket is sufficient to migrate the record library; no DynamoDB export is needed. Live games and existing archives continue to use the existing DynamoDB table. Upload retries reuse an ID and cannot replace a different SGF. Library listing paginates S3 prefixes (30 at a time); loaded results are sorted by upload date. Global search, collections and library-wide sorting are not implemented. All uploaded records are readable by anyone who has the app link. No account system is added.

Production uses the `WeiqiFargate` and `WeiqiGpuBenchmark` CloudFormation stacks. Eligible uploads enqueue SQS messages. A short-lived Lambda selects the latest official network once per game, submits a **32-vCPU / 60-GB Fargate quick job at 8 visits** and a **T4 GPU deep job at 1,000 visits**, then returns without waiting. Both passes use the same model. GPU settings are 16 analysis threads and NN batch size 32; the instance is g4dn.xlarge (4 vCPUs / 16 GB RAM / 16 GB GPU memory). Every worker freshly downloads its selected official model; no neural-network file is cached or reused between jobs. The GPU image contains official KataGo 1.18.2; CPU jobs download and verify official KataGo 1.18.1. Results retain actual compute, engine version, model name/URL/SHA-256 and settings.

Quick work is independent of GPU capacity. A delayed SQS message checks deep work ten minutes after the original enqueue timestamp. If the GPU job has not started, the fallback confirms cancellation before submitting a 32-vCPU / 60-GB CPU job at 96 visits. Lost submit responses are recovered by job lookup rather than blind resubmission. This fallback has lower depth and is clearly recorded in provenance. No periodic idle Lambda runs. CPU quick and fallback queues each allow 64 vCPUs, subject to the regional account quota. GPU minimum capacity is zero and deliberate scale-down delay is disabled. Containers save results and exit; Batch releases unused GPU instances. There is no NAT gateway, persistent analysis service or capacity reservation. A separate four-hour safety timeout handles stuck jobs; speed targets are not job timeouts. Failed jobs update status through EventBridge and Lambda.

The daily cap reserves up to 20 public analysis slots per London date in `daily-analysis/`, independently of sequential game IDs. Operator benchmark records do not consume this allowance. Each eligible public upload launches both analyses. Later records still save and replay. The API serves `analysis-quick.json` as soon as the quick phase is ready; the viewer stops polling and tells users to refresh the page for deeper results. Once deep analysis completes, metadata selects `analysis.json`; a page refresh displays it in place of the preliminary results. The selected move is retained per game in session storage across a refresh. Quick-result polling preserves the currently selected move. Conditional metadata updates prevent either worker from losing the other phase's status. A late quick result cannot downgrade completed deep analysis. Failures in the deep phase leave quick results available. Existing single-pass records remain supported.

The committed `cloud/deployment-config.json` selects the production stacks and queue. Explicit CDK context arguments override this profile. `make deploy` tests, deploys the CloudFormation stacks and publishes static files. Update `code/fargate-worker.py` in the library bucket and rebuild the CloudFormation-managed GPU CodeBuild image when the worker changes. The GPU image contains the worker and engine, never model weights. The queue cutover first enables and validates a separate replacement queue, changes the upload API atomically, then drains and removes the legacy consumer and queue.

`node scripts/benchmark-hybrid.mjs <sgf-path>` validates the actual SQS→dispatcher→CPU quick/GPU deep route with a titled public full-game record. It records the shared original enqueue timestamp and publishes measured phase results. It does not terminate other production jobs or disable production capacity. `scripts/benchmark-fargate.mjs` and `scripts/benchmark-gpu.mjs` are experimental worker comparisons; do not use the latter against production capacity because its cleanup intentionally stops benchmark instances. `scripts/collect-fargate-benchmarks.mjs` collects trigger, startup, image pull, setup, engine analysis, saving and regional cost estimates. No SGFs or neural-network weights are committed.

Run a file-backed local preview, with your installed KataGo/model:

```sh
PORT=4190 \
LIBRARY_DIR=/private/tmp/weiqi-record-library \
KATAGO_MODEL=/absolute/path/to/model.bin.gz \
KATAGO_VISITS=10 npm start
```

Then open `http://127.0.0.1:4190/library.html`. Local uploads run one analysis job at a time. The debugging setting is **10 visits per position** (the worker default remains 1), one analysis thread, one search thread, batch size 1 and a small cache. These are deliberately rough evaluations. `KATAGO_BIN` selects another executable. Without a model, files still save and remain queued. The local library survives preview restarts; the separate live preview game remains in memory.

Retry a failed local record, or explicitly replace analysis with a higher depth:

```sh
KATAGO_MODEL=/absolute/path/to/model.bin.gz \
KATAGO_VISITS=1000 KATAGO_FORCE=1 \
node scripts/analysis-worker.mjs /absolute/path/to/library <game-id>
```

`KATAGO_TIMEOUT_MS` controls the local analysis time limit (default 120 seconds). Increasing depth can require raising it. The worker stores engine version, model filename/hash, SGF hash, rules, komi, visits and elapsed time with the evaluations. Results are published atomically before metadata changes to ready. An existing complete result is reused unless explicitly forced. Test records stay outside the repository. CPU and Ireland GPU benchmark results are available at `/benchmarks.html`.

The bilingual `/how-to-use.html` explains the user workflow and controls. `/about.html` explains the technical architecture.

New uploads use London-date IDs `YYYYMMDD01`, `YYYYMMDD02`, etc. Atomic S3 reservations prevent concurrent collisions; upload UUID mappings preserve retry identity. Legacy UUID links still work. Copy `uploads/` and `reservations/` along with `games/` when migrating writable storage. SGFs without `RU` use Japanese analysis rules; the viewer shows the actual analysis rules and komi. Analysis provenance shows engine version, network dimensions, actual visits for the selected position, visit limit and completion timestamp.

During cloud debugging, `scripts/cloud-analysis-worker.mjs` bridges the cloud queue to the locally installed engine. Set `LIBRARY_BUCKET`, `ANALYSIS_QUEUE`, `KATAGO_MODEL` and optionally `KATAGO_VISITS=10`, then run `node scripts/cloud-analysis-worker.mjs` to process one queued message or add `--watch` to keep listening. It uses the AWS CLI's existing identity; credentials are never sent to browsers. Conditional S3 metadata claims prevent duplicate work. Results are saved to S3 before readiness is published. This bridge requires the local machine and worker to be running; it is not an autonomous cloud compute service and adds no rented compute. Stop it with Ctrl-C. Failed jobs remain readable and are marked failed.

Development/debugging AWS spending is capped at **US$30** by the user. CPU and GPU comparisons share that same total budget. Audit existing jobs before launching additional development work; billing reports can lag, so use conservative task-duration estimates as well. This development cap is separate from the public daily analysis allowance.


## GPU comparison and benchmark history

All resource provisioning uses CDK-generated CloudFormation in **eu-west-1 (Ireland)**. Batch manages temporary EC2 workers under its CloudFormation compute environments. Workers have zero minimum capacity; no NAT gateway is deployed. Do not provision separate untracked instances.

`/benchmarks.html`, linked from About, shows completed and ongoing experiments, including the earlier 2-, 4- and 8-CPU measurements. Failed or stopped runs are excluded from the public page. The internal catalog retains their costs for the $30 development budget. Update measured results with `node scripts/update-benchmarks.mjs --publish`; GPU runners publish when an experiment is submitted or completed. No SGFs or neural-network weights are committed.

For the 321-move representative SGF, the hybrid workflow's 8-visit CPU quick result arrived in **3m39s from SQS enqueue**, including queue and setup. Prior 8-visit runs took 3m25s and 3m49s including their queue/startup. T4 at 1,000 visits took about 15–16 minutes of processing in separate comparisons. The final workflow records the actual total from SQS for both phases. T4 128- and 64-visit cold quick experiments exceeded five minutes because queue/capacity/startup consumed most of that allowance; this is why the quick pass uses CPU. Increasing GPU analysis threads to 32 and batch size to 64 did not improve the deep run. A10G completed engine work faster but waited about 16 minutes for capacity, so it is excluded as primary production compute. These are measurements, not a guarantee of future cloud capacity or model runtime. Benchmarks compare consistency on a game, not independently proven analysis accuracy.

Total waiting time starts at SQS enqueue and includes queueing, capacity acquisition, startup, model downloads, analysis and saving. The replay page shows elapsed total while pending, then a fixed completed total alongside engine time. Benchmark experiments show both total and processing time; manual worker experiments start at Batch submission, while workflow experiments use the original SQS timestamp. Quick results must meet a five-minute end-to-end target. Deep results target one hour, with two hours as the maximum waiting expectation. Concurrent uploads and future latest models can increase waiting. The UI reports actual times without hiding queue delay.

The user permits losing existing development records. Failed/stopped benchmarks remain only in the internal spend catalog. The US$30 development/debugging cap covers all CPU/GPU runs, builds, setup, idle allocation and other service use. Production aims for both analyses below US$1 per game. Cost estimates are not final invoices; AWS billing data can lag.
