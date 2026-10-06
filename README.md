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

The cloud worker is deployed in a separate `WeiqiFargate` stack. Eligible uploads enqueue SQS messages. A short-lived Lambda selects the latest official network once per game, submits quick and deep AWS Batch/Fargate CPU jobs using that same network, and returns without waiting. Both passes use 32 vCPUs/60 GB and the latest official CPU engine (currently KataGo 1.18.1). Quick analysis uses 10 visits per position; deep analysis uses 128. Separate compute environments each have one 32-vCPU slot, so deep work does not occupy quick capacity. No NAT gateway or persistent compute runs. Every container downloads a checksum-verified engine and its own fresh official model; no neural-network file is cached in S3 or reused between jobs. Results retain engine version, model name/URL/SHA-256 and the effective configuration. Containers save results and exit. A separate four-hour safety timeout handles stuck jobs; the one-hour performance target is not a job timeout. Failed jobs update status through EventBridge and Lambda.

The daily cap reserves up to 20 public analysis slots per London date in `daily-analysis/`, independently of sequential game IDs. Operator benchmark records do not consume this allowance. Each eligible public upload launches both analyses. Later records still save and replay. The API serves `analysis-quick.json` as soon as the quick phase is ready; the viewer stops polling and tells users to refresh the page for deeper results. Once deep analysis completes, metadata selects `analysis.json`; a page refresh displays it in place of the preliminary results. The selected move is retained per game in session storage across a refresh. Quick-result polling preserves the currently selected move. Conditional metadata updates prevent either worker from losing the other phase's status. A late quick result cannot downgrade completed deep analysis. Failures in the deep phase leave quick results available. Existing single-pass records remain supported.

Deploy/update workers after deploying the main site and uploading `cloud/worker/worker.py` to `code/fargate-worker.py` in the library bucket:

```sh
cd cdk
npx cdk deploy WeiqiFargate --require-approval never -c fargate=true \
  -c libraryBucket=<library-bucket> -c analysisQueueArn=<upload-queue-arn>
```

Run `scripts/benchmark-fargate.mjs <sgf-path> <output-dir> 32:60 <visits> latest <quick|deep>` for the selected 32-CPU worker. Each benchmark creates a titled public record; the watcher publishes complete results to that record. `scripts/collect-fargate-benchmarks.mjs` collects request trigger, container startup, image pull, setup, engine analysis, saving, result-ready and billable task duration, plus regional cost estimates. The initial 139-move test measured engine times of 169.6s, 91.0s and 49.9s, respectively. These are single-run measurements, with thread counts scaled to CPU size. GPU capacity was initially blocked by account quotas. Ireland GPU benchmarks are now running after approval. Main benchmark totals exclude queue time. Benchmark SGFs/results remain outside the repository. The latest-model 321-move quick benchmark at 10 visits completed in 233.8 seconds excluding queue time: 0.36s trigger request, 25.9s task startup (including 3.7s image pull), 4.5s setup, 202.6s engine analysis, and 0.46s finalization/saving. Estimated compute and public IP cost was $0.102. The earlier 8-visit run took 222.9s, including 170.5s in the engine, at $0.098. The 128-visit deep run took 2,215.1 seconds (36m 55s): 0.34s trigger, 27.2s startup (including 6.6s image pull), 18.3s setup, 2,168.8s analysis and 0.46s saving, at about $0.965. The 4-visit alternative took 128.6s at $0.059. Against the 128-visit reference, the 10-visit run differed by 0.31 points and 1.51 win-probability percentage points on average; its largest win-probability difference was 33.34 percentage points. Quick results remain preliminary. This compares consistency on one game, not proven accuracy. See `cloud/benchmark-summary-20261006.json` for the complete measurements. Future latest models and longer games can take more time.

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

Development/debugging AWS spending is capped at **US$30** by the user. Paid GPU comparisons remain in progress within that same total budget. Audit existing jobs before launching additional development work; billing reports can lag, so use conservative task-duration estimates as well. This development cap is separate from the public daily analysis allowance.


## GPU comparison and benchmark history

All resource provisioning uses CDK-generated CloudFormation in **eu-west-1 (Ireland)**. Batch manages temporary EC2 workers under its CloudFormation compute environments. Workers have zero minimum capacity; no NAT gateway is deployed. Do not provision separate untracked instances.

`/benchmarks.html`, linked from About, shows completed and ongoing experiments, including the earlier 2-, 4- and 8-CPU measurements. Failed or stopped runs are excluded from the public page. The internal catalog retains their costs for the $30 development budget. Update measured results with `node scripts/update-benchmarks.mjs --publish`; GPU runners publish when an experiment is submitted or completed. No SGFs or neural-network weights are committed.

The 321-move game on NVIDIA T4 (`g4dn.xlarge`, 4 vCPUs / 16 GB) completed 128-visit analysis in 3m55 including cold startup, and 1,000-visit analysis in 16m19 including a separate cold startup. Engine times were 2m15 and 14m46, respectively. Estimated processing costs were $0.04 and $0.17, with idle allocation, teardown and small services accounted for separately. Both used the same freshly downloaded latest official network and KataGo 1.18.2, 16 analysis threads and NN batch size 32. The current production dispatcher still uses CPU until the GPU comparison and deployment are finalized.

The production availability target is 95%. A10G experienced about 16 minutes of capacity waiting before launching, so it is excluded as the primary production choice despite faster inference. Successful benchmark launches alone do not demonstrate 95% availability. Multiple Ireland zones and alternate instance pools improve launch options; no idle capacity reservation is provisioned. Existing development game records are disposable.


Total waiting time now starts at SQS enqueue and includes queueing, capacity acquisition, startup, model downloads, analysis and saving. The replay page shows the running elapsed total, then a fixed completed total alongside engine time. Benchmarks show both total and processing time; manual benchmark clocks start at Batch submission rather than a production upload. Quick results must meet a five-minute end-to-end target. Deep results target one hour, with two hours as the maximum waiting expectation. These are performance criteria, separate from stuck-job timeouts.

The GPU production route is staged in the existing `WeiqiGpuBenchmark` CloudFormation stack, with upload dispatch disabled until validation completes. It uses T4 only, across three Ireland zones, and shares the existing Fargate stack as capacity fallback. A delayed SQS message checks queued quick work after 60 seconds from the original enqueue timestamp and queued deep work after ten minutes. No periodic idle Lambda runs. The fallback confirms the GPU job is cancelled before submitting CPU work; it recovers lost submit responses by looking up the submitted CPU job. CPU fallback uses 32 vCPUs / 60 GB, four quick visits or 96 deep visits, clearly recorded in analysis provenance. The production dispatch plan uses 64 quick GPU visits and 1,000 deep visits, subject to the current final benchmarks.
