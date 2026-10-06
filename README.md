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

Metadata is also stored in files, so copying the bucket is sufficient to migrate the record library; no DynamoDB export is needed. Live games and existing archives continue to use the existing DynamoDB table. Upload retries reuse an ID and cannot replace a different SGF. Library listing reads the reverse-timestamp index and returns ten records per page. Global search, collections and library-wide sorting are not implemented. All uploaded records are readable by anyone who has the app link. No account system is added.

Production uses the `WeiqiSite`, `WeiqiStorage` and `WeiqiGpuBenchmark` CloudFormation stacks. Eligible uploads enqueue SQS messages. A short-lived Lambda selects the latest official network once per game and submits one T4 GPU job, then returns without waiting. The worker runs quick analysis at **32 visits**, followed by deep analysis at **up to 3,000 visits**, using the same model. GPU settings are 16 analysis threads and NN batch size 32; the primary instance is g4dn.xlarge (4 vCPUs / 16 GB RAM / 16 GB GPU memory). Every pass freshly downloads its selected official model; neural-network weights are never cached or saved to S3. The GPU image contains official KataGo 1.18.2. Results retain actual compute, engine version, model name/URL/SHA-256 and settings. The final production routing and retry policy are described below; CPU workers are no longer deployed.

GPU minimum capacity is zero and deliberate scale-down delay is disabled. Containers save results and exit; Batch releases unused instances. There is no NAT gateway, persistent analysis service or capacity reservation. A separate four-hour safety timeout handles stuck jobs; speed targets are not job timeouts. Failed jobs update status through EventBridge and Lambda.

The daily cap reserves up to 20 public analysis slots per London date in `daily-analysis/`, independently of sequential game IDs. Operator benchmark records do not consume this allowance. Each eligible public upload launches both analyses. Later records still save and replay. The API serves `analysis-quick.json` as soon as the quick phase is ready; the viewer stops polling and tells users to refresh the page for deeper results. Once deep analysis completes, metadata selects `analysis.json`; a page refresh displays it in place of the preliminary results. The selected move is retained per game in session storage across a refresh. Quick-result polling preserves the currently selected move. Conditional metadata updates prevent either worker from losing the other phase's status. A late quick result cannot downgrade completed deep analysis. Failures in the deep phase leave quick results available. Existing single-pass records remain supported.

The committed `cloud/deployment-config.json` selects the production stacks and queue. Explicit CDK context arguments override this profile. `make deploy` tests, deploys the CloudFormation stacks and publishes static files. Rebuild the CloudFormation-managed GPU CodeBuild image when `cloud/worker/worker.py` changes. The GPU image contains the worker and engine, never model weights. The queue cutover first enables and validates a separate replacement queue, changes the upload API atomically, then drains and removes the legacy consumer and queue.

Historical hybrid validation: `node scripts/benchmark-concurrency.mjs <sgf-path>` submitted two full-game workflows together through the actual SQS dispatcher. It starts only when previous GPU workers have retired, creates two titled public records, and records queue-inclusive timing for each pass. Ireland's approved eight-vCPU G/VT quota permits up to two T4 workers, with zero minimum capacity.

Historical hybrid validation: `node scripts/benchmark-hybrid.mjs <sgf-path>` validated the actual SQS→dispatcher→CPU quick/GPU deep route with a titled public full-game record. It records the shared original enqueue timestamp and publishes measured phase results. It does not terminate other production jobs or disable production capacity. `scripts/benchmark-fargate.mjs` and `scripts/benchmark-gpu.mjs` are experimental worker comparisons; do not use the latter against production capacity because its cleanup intentionally stops benchmark instances. `scripts/collect-fargate-benchmarks.mjs` collects trigger, startup, image pull, setup, engine analysis, saving and regional cost estimates. No SGFs or neural-network weights are committed.

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

Production now uses GPU-only analysis. A single T4 allocation (`g4dn.xlarge`, 4 vCPUs / 16 GB RAM / 16 GB VRAM) runs quick analysis at **32 visits**, then deep analysis at **up to 3,000 visits**. Both use the latest official model, 16 analysis threads, one search thread and NN batch size 32. Every pass downloads the selected model fresh; weights are never saved to S3 or cached across passes. The earlier **1,000-visit** 321-move production validation at `/record/2026100618` delivered all 322 quick positions in **3m17s from SQS enqueue**. Deep results arrived in **18m15s from the same enqueue timestamp**. The conservative estimate for the complete shared GPU allocation was **$0.28**, before small API/storage/log usage. The final production report contains the paired measurement.

Queued GPU work gets a capacity check after three minutes. If it is still waiting, cancellation must be confirmed before a replacement is submitted to the GPU fallback pool, using the same model and visits. The first fallback is an independent capacity-optimized Spot queue using T4 (`g4dn.xlarge`) or A10G (`g5.xlarge`), with a separate approved four-vCPU quota. If that job remains queued for another three minutes, confirmed cancellation precedes a switch to the A10G On-Demand queue. The worker reads `nvidia-smi` to record the GPU and matching instance type actually selected. Spot interruptions enter the same bounded retry path. A job that starts during cancellation stays in place, avoiding a second paid worker. A10G is a fallback because its earlier capacity wait was variable, despite faster engine processing. If the A10G On-Demand fallback is still unavailable after fifteen minutes of queueing, the queued job is cancelled and enters the same bounded delayed-retry workflow. Running analysis is not interrupted by this capacity check. There is **no CPU fallback**. Failed jobs get at most two later retries, five minutes and then fifteen minutes after failure. Retries alternate GPU pools and skip completed passes; the browser displays errors, retry timestamps with timezone and countdown. S3 compare-and-swap claims, deterministic Batch names and submission recovery prevent ordinary duplicate deliveries from launching paid duplicates. Worker ownership tokens reject stale attempts. A delayed SQS control queue handles capacity checks and retries; Lambda never waits for the analysis.

After Ireland approved an eight-vCPU G/VT quota, two cold full-game workflows ran concurrently. Quick totals were **3m30s and 3m31s**; 1,000-visit T4 deep totals were **16m43s and 17m37s**, all measured from SQS enqueue. Both GPU workers retired automatically. Paired costs including CPU tasks and complete GPU allocations were conservatively estimated at **$0.26 and $0.29** before small API/storage/log usage. Stage timings and allocation details are in `cloud/benchmark-concurrency-summary.json`. The test also caught and fixed the IAM permission required for an unqualified latest-revision CPU job-definition ARN; the two unsubmitted failed startup attempts did not run compute and are excluded from public benchmark results.

Total waiting time starts at SQS enqueue and includes queueing, capacity acquisition, startup, model downloads, analysis and saving. The replay page shows elapsed total while pending, then a fixed completed total alongside engine time. Benchmark experiments show both total and processing time; manual worker experiments start at Batch submission, while workflow experiments use the original SQS timestamp. Quick results must meet a five-minute end-to-end target. Deep results target one hour, with two hours as the maximum waiting expectation. Concurrent uploads and future latest models can increase waiting. The UI reports actual times without hiding queue delay.

Historical development records were disposable; production records are protected. Failed/stopped benchmarks remain only in the internal spend catalog. The US$30 development/debugging cap covers all CPU/GPU runs, builds, setup, idle allocation and other service use. Production aims for both analyses below US$1 per game. Cost estimates are not final invoices; AWS billing data can lag.

## Move review and recommended lines

New analyses retain KataGo's ranked `moveInfos` candidates and principal variations in the existing S3 result files (schema version 2). Each position stores up to eight leading candidates, plus the played move if it was searched outside that set, and at most twelve PV moves per candidate. The engine request uses `analysisPVLen: 11` (the first candidate move is additional). Visits and compute settings are unchanged; viewing suggestions starts no paid job.

Move review is on by default and remembers the viewer's choice locally. At recorded move N, the board markers and candidate buttons suggest move N+1 from the analysis of displayed position N, for its player to move. The separate rating of recorded move N compares candidates from its parent position N−1. Best means KataGo's order-zero move, rather than a mathematically perfect move. Point loss is computed from the played player's perspective. Good / Inaccuracy / Mistake / Blunder use ≤0.5 / ≤2 / ≤5 / >5 points. When the played candidate has fewer than max(2, 3% of the best candidate's visits), the following analysed position supplies the played evaluation and the rating is marked estimated. All quick ratings are preliminary. Up to three next-move candidates within one point and five win-percentage points of the engine's best are offered, excluding underexplored alternatives; the best candidate is always included.

Select a suggestion to replay its numbered line using arrow keys or buttons. Return to record restores the selected recorded move. Previews do not change the SGF or request new analysis. The browser enforces simple ko for Japanese/Korean rules and positional superko for other supported rules while replaying; a line stops safely if it cannot be reproduced. Older analyses without candidates remain readable and show an explanation, without automatically launching paid work.

Full-game move-review validation used the representative 321-move game at `/record/2026100617`. Quick analysis arrived in **2m59s** and T4 deep analysis in **18m31s**, including queue/setup. All 322 positions in each pass retained suggestions. All 588 quick and 672 displayed deep alternatives replayed legally, including twelve-move deep lines. Browser verification matched the first 100 recorded boards and a complete twelve-move alternative, checked the saved toggle, mobile chart placement, return to record and manual deep refresh. Both jobs succeeded and the GPU instance retired automatically. See `cloud/ai-review-validation.json` for the test evidence and conservative allocation costs.

## Protected production storage

`WeiqiStorage` owns the existing S3 record bucket, its SSL-only policy and the DynamoDB game table. They were moved intact with CloudFormation stack refactoring; no bucket or table was recreated. `WeiqiSite` and `WeiqiGpuBenchmark` hold site/API and temporary compute resources. The obsolete `WeiqiFargate` stack is removed. All stacks remain in Ireland, apart from CloudFront’s required existing global certificate.

Storage has stack termination protection, `Retain` deletion/replacement policies, S3 versioning, DynamoDB deletion protection and point-in-time recovery. `cloud/storage-stack-policy.json` denies CloudFormation replacement/deletion of the bucket or table. A direct data edit still requires normal care; stack protection is not an immutable backup. The harmless `StorageAnchor` CloudFormation handle supported the migration and has no running compute.

Deploy with CDK, then publish assets. After first creation or migration, apply the committed policy with `aws cloudformation set-stack-policy --region eu-west-1 --stack-name WeiqiStorage --stack-policy-body file://cloud/storage-stack-policy.json`. Do not disable storage protection during compute cleanup. Back up or migrate the entire bucket including ID/upload mappings and daily allowance files.

## Stronger deep analysis and printable reports

New production requests use at most 3,000 deep visits. For more than 321 moves, the limit scales as floor(3,000 × 322 / positions), keeping the processing estimate near the measured full-game envelope. Quick remains 32 visits. The completed 321-move production benchmark at `/record/2026100620` delivered quick results in **3m28s** and 3,000-visit deep results in **45m35s**, both measured from the original SQS enqueue and including queue/setup. The conservative estimate for the complete shared T4 allocation, including automatic worker retirement, is **$0.48**, before small API/storage/log usage. Cloud queues, newer models and retries can change time/cost. Actual configuration and timing remain visible. Older saved results are not automatically reanalysed.

Replay highlights next-move candidates directly on empty board points: blue for the engine's first choice, green for similarly strong alternatives, labelled A/B/C to match the buttons. Markers and candidate buttons recommend the next move for the player to move from the displayed position. Click a marker to replay its saved continuation from that board, with normal captures. The last recorded move’s quality ring and rating still use its preceding position. The default-on move-review toggle also hides board markers. Recorded stones retain quality rings and remain unchanged.

After deep completion, Generate AI report opens `/record/<id>/report`. The existing Lambda computes metrics from saved SGF/results, checks the SGF hash and complete main-line coverage, and saves a cached JSON report under `games/<id>/reports/<analysis-hash>.json`. The schema version is part of the cache key. Reports focus on bad moves. Statistics cover rated/unrated moves, error counts and rates, severity counts, total bad-move point loss, mean/median/90th percentile loss, top-five loss concentration, mean/max win-rate drops, 10/20 percentage-point drops, missed available leads/winning chances, move-range summaries and loss distributions. Charts show per-move losses, cumulative bad-move losses and game context. Summed losses are diagnostic aggregates rather than the final score; phase ranges are fixed and opportunity counts compare the recommended versus played choices. Good-move and best-match statistics are omitted. Reports automatically list the five largest estimated point losses for each side (>0.5 points, excluding best/good moves), with the played board and numbered best continuation. If fewer qualify, only those available are listed. Every report includes a complete English version followed by a complete Chinese version, using the same saved analysis and fixed settings, with no player/count/exercise configuration. Report rendering does not change the app language preference. No new analysis, Fargate worker or language-model call is triggered. Estimated played evaluations are labelled. Print / Save PDF uses SVG board diagrams; PDF export testing remains deferred at the user's request.
