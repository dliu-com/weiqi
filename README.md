# Weiqi · 围棋

A public 19 × 19 Go app at https://weiqi.dliu.com. Chinese and English interface; first visit follows the browser language, with a remembered language switch.

## App flows

- `/`: landing page and AI features.
- `/play`: one public live game, on one device or across devices. End game opens a winner/draw choice. Finishing saves automatically to the library, clears the shared live board and starts the next game on `/play`.
- `/record`: one public, autosaved recording draft. Enter moves or import SGF after confirmation; keep variations, promote the preferred branch and save only the main line. Saving confirms deletion of other draft branches and treats unfinished games as Draw. Once publication succeeds, the shared draft clears all moves, branches and metadata; the saved library record opens. Failed saves keep the workspace recoverable. A revision conflict preserves a browser backup instead of overwriting another device.
- `/analysis`: automatic Lambda photo recognition, local SGF import or hand set-up, then one cloud KataGo request per analysis and one playable sequence. Photo recognition uploads the compressed photo; analysis sends the position and available move history. Neither saves photos, games or results in cloud storage. Only the position/moves/settings survive refresh in browser storage. The page is plain ES modules (`src/analysis.js`, `analysis-position.js`, `position-api.js`) that reuse the shared site shell, board, SGF and style files; there is no bundler. `make build-local-analysis` only writes the licence files and the corresponding-source download.
- `/game`: newest ten saved games per page; `/game/<id>` provides replay and AI. Legacy `/record/<id>` links still work.
- `/guide`: site-specific workflow; `/about`: architecture and links to `/cost`, `/security` and `/photo-recognition` (how photo recognition works, its test results and limits).

Shared `AppShell` owns navigation/language; `BoardView` owns interactive boards. `board-geometry.js` supplies geometry to both interactive and printable boards. Reports keep the shared sticky header and add Save PDF. Viewer timestamps use device-local time with an explicit UTC offset; prepared report timestamps remain server UTC.

The `/play` and `/record` workspaces and saved library records are public. `/analysis` keeps its saved game in the browser; photo recognition and the optional cloud AI process uploads without storing them. There are no accounts or ownership controls. Editing the draft never changes previously saved games. AI starts after publication, not while editing. The recording draft is stored in protected DynamoDB; saved SGF/metadata/analysis live in protected S3.

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

Incremental fixed monthly service fees: **$0**, excluding existing domain/hosted-zone costs. Idle retained storage, the GPU worker image and the spending-guard schedule cost about $0.30–$0.50/month at current sizes; project policy caps idle cost at $2/month and deploys every resource through CloudFormation. Retained storage, PITR, API traffic, report preparation and GPU allocations are usage-billed even when storage persists between visits. Plan around $0.50–$0.75 per normal full T4 game; fallback and retries can exceed $1. See `/cost`. DynamoDB stores current live play and the shared draft; saved games use S3. Legacy archived rows remain readable, but new games no longer create a second history library. WeiqiStorage is retained and protected independently of compute stacks.

The browser sends only move commands; the backend validates rules. Game state is read consistently from DynamoDB and saved with revision checks. No AWS credentials appear in the static app. The public shared game has no user authentication.


## Review, metadata, clocks and SGF

Undo removes the withdrawn move from the saved move tree and SGF export. Reviewing a node supports temporary local trial moves, with undo and clear controls. Trial moves are never saved or exported. Selecting another node or Return to live discards them; live sync continues while reviewing. Finishing a game saves its main line to the public S3 library. A completed save automatically starts a clean live game; there is no manual New game action. The separate history page redirects to `/game`. Legacy archive reads remain available, with edits disabled.

Move timestamps and player clock totals are recorded from this version onward. Legacy move timestamps cannot be recovered. Timing starts after the first move, uses visible-page heartbeats every five seconds, and can be paused/resumed. After one minute without a heartbeat from any device it automatically pauses, excluding time after the last heartbeat; returning resumes automatically unless manually paused. There is no scheduled background service. Disabling auto-sync also stops that device’s heartbeats. Scoring stops the clock. Undo does not refund elapsed thinking time. Both clients display the same server-maintained totals; device clock accuracy affects the live ticking display.

Download SGF exports the complete tree, player names, game name, result, and timing comments in UTF-8 SGF FF[4]. [Format reference](https://www.red-bean.com/sgf/sgf4.html). Timing is elapsed time, not a countdown; standard time-left properties are intentionally not used.

This remains a public shared app. Game metadata/history is stored in DynamoDB, never committed to this repository. Tests use fictional names and isolated in-memory records. Do not commit production game exports, credentials, or deployment output.

The bilingual rules and controls guide is available at /rules.html. It is static and sends no game API requests.


## Portable SGF library and local KataGo development

The library lists the newest 10 records per page, with Previous/Next navigation. A reverse-timestamp `library-index/` of small S3 JSON files supports bounded newest-first reads; entries point to authoritative game metadata. Rebuild the index from existing files with `node scripts/rebuild-library-index.mjs <bucket>`.

`/game` accepts a single UTF-8 19 × 19 Go SGF (up to 256 KB, 2,000 SGF nodes). Each record receives a permanent `/record/<game-id>` link. Replay is immediate, even while analysis is queued/running. The viewer checks for quick results once a minute, pauses while hidden and stops automatic checking when quick results arrive or fail. Deeper results are checked only on a manual page refresh. A spinner shows remaining processing time and an estimated completion timestamp with UTC offset and browser time zone. Queued jobs show the jobs ahead, workers already running or starting, and conservative single start/finish timestamps rounded up to the minute, based on their remaining quick-plus-deep work. Forecasts stay anchored to submission and worker timestamps rather than moving forward with every clock tick. Queue and setup time is included in the conservative projected finish timestamp. If AWS capacity is unavailable, queue data is incomplete, or a forecast expires, the page says a reliable start time is unavailable; it does not invent a new deadline. Read-only Batch status snapshots are cached for 15 seconds per warm API instance. The countdown updates locally; it does not poll deep results. Quick results appear automatically without starting another job. A page refresh selects completed deep results. The viewer shows point advantage and Black win rate, a clickable, draggable Black/White graph with Score and Win % modes, keyboard navigation, ±10-move jumps, autoplay and unsaved trial moves. SGF variations can be reviewed; analysis covers the main line only. Setup changes after the initial position and non-UTF-8 encodings are rejected with an error. The original file is preserved for download, including properties the viewer does not display.

A dedicated private, encrypted, retained S3 bucket stores:

```text
games/<game-id>/original.sgf
games/<game-id>/metadata.json
games/<game-id>/analysis-quick.json
games/<game-id>/analysis.json
```

Metadata is also stored in files, so copying the bucket is sufficient to migrate the record library; no DynamoDB export is needed. Live games and existing archives continue to use the existing DynamoDB table. Upload retries reuse an ID and cannot replace a different SGF. Library listing reads the reverse-timestamp index and returns ten records per page. Global search, collections and library-wide sorting are not implemented. All uploaded records are readable by anyone who has the app link. No account system is added.

Production uses the `WeiqiSite`, `WeiqiStorage` and `WeiqiGpuBenchmark` CloudFormation stacks. Eligible uploads enqueue SQS messages. A short-lived Lambda selects the latest official network once per game and submits one T4 GPU job, then returns without waiting. The worker runs quick analysis at **32 visits**, followed by deep analysis at **up to 3,000 visits**, using the same model. GPU settings are 16 analysis threads and NN batch size 32; the primary instance is g4dn.xlarge (4 vCPUs / 16 GB RAM / 16 GB GPU memory). Every pass freshly downloads its selected official model; neural-network weights are never cached or saved to S3. The GPU image contains official KataGo 1.18.2. Results retain actual compute, engine version, model name/URL/SHA-256 and settings. The final production routing and retry policy are described below; CPU workers are no longer deployed.

GPU minimum capacity is zero and deliberate scale-down delay is disabled. Containers save results and exit; Batch releases unused instances. There is no NAT gateway, persistent analysis service or capacity reservation. A separate two-hour safety timeout handles stuck jobs; speed targets are not job timeouts. Failed jobs update status through EventBridge and Lambda.

The daily cap reserves up to 10 public analysis slots per London date in `daily-analysis/`, independently of sequential game IDs. Operator benchmark records do not consume this allowance. Each eligible public upload launches both analyses. Later records still save and replay. The API serves `analysis-quick.json` as soon as the quick phase is ready; the viewer stops polling and tells users to refresh the page for deeper results. Once deep analysis completes, metadata selects `analysis.json`; a page refresh displays it in place of the preliminary results. The selected move is retained per game in session storage across a refresh. Quick-result polling preserves the currently selected move. Conditional metadata updates prevent either worker from losing the other phase's status. A late quick result cannot downgrade completed deep analysis. Failures in the deep phase leave quick results available. Existing single-pass records remain supported.

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

Then open `http://127.0.0.1:4190/game`. Local uploads run one analysis job at a time. The debugging setting is **10 visits per position** (the worker default remains 1), one analysis thread, one search thread, batch size 1 and a small cache. These are deliberately rough evaluations. `KATAGO_BIN` selects another executable. Without a model, files still save and remain queued. The local library survives preview restarts; the separate live preview game remains in memory.

Retry a failed local record, or explicitly replace analysis with a higher depth:

```sh
KATAGO_MODEL=/absolute/path/to/model.bin.gz \
KATAGO_VISITS=1000 KATAGO_FORCE=1 \
node scripts/analysis-worker.mjs /absolute/path/to/library <game-id>
```

`KATAGO_TIMEOUT_MS` controls the local analysis time limit (default 120 seconds). Increasing depth can require raising it. The worker stores engine version, model filename/hash, SGF hash, rules, komi, visits and elapsed time with the evaluations. Results are published atomically before metadata changes to ready. An existing complete result is reused unless explicitly forced. Test records stay outside the repository. CPU and Ireland GPU benchmark results are available at `/benchmarks.html`.

The bilingual `/guide` explains the user workflow and controls. `/about.html` explains the technical architecture.

New uploads use London-date IDs `YYYYMMDD01`, `YYYYMMDD02`, etc. Atomic S3 reservations prevent concurrent collisions; upload UUID mappings preserve retry identity. Legacy UUID links still work. Copy `uploads/` and `reservations/` along with `games/` when migrating writable storage. SGFs without `RU` use Japanese analysis rules; the viewer shows the actual analysis rules and komi. Analysis provenance shows engine version, network dimensions, actual visits for the selected position, visit limit and completion timestamp.

During cloud debugging, `scripts/cloud-analysis-worker.mjs` bridges the cloud queue to the locally installed engine. Set `LIBRARY_BUCKET`, `ANALYSIS_QUEUE`, `KATAGO_MODEL` and optionally `KATAGO_VISITS=10`, then run `node scripts/cloud-analysis-worker.mjs` to process one queued message or add `--watch` to keep listening. It uses the AWS CLI's existing identity; credentials are never sent to browsers. Conditional S3 metadata claims prevent duplicate work. Results are saved to S3 before readiness is published. This bridge requires the local machine and worker to be running; it is not an autonomous cloud compute service and adds no rented compute. Stop it with Ctrl-C. Failed jobs remain readable and are marked failed.

Development/debugging AWS spending is capped at **US$30** by the user. CPU and GPU comparisons share that same total budget. Audit existing jobs before launching additional development work; billing reports can lag, so use conservative task-duration estimates as well. This development cap is separate from the public daily analysis allowance.


## GPU comparison and benchmark history

All resource provisioning uses CDK-generated CloudFormation in **eu-west-1 (Ireland)**. Batch manages temporary EC2 workers under its CloudFormation compute environments. Workers have zero minimum capacity; no NAT gateway is deployed. Do not provision separate untracked instances.

`/benchmarks.html`, linked from About, shows completed and ongoing experiments, including the earlier 2-, 4- and 8-CPU measurements. Failed or stopped runs are excluded from the public page. The internal catalog retains their costs for the $30 development budget. Update measured results with `node scripts/update-benchmarks.mjs --publish`; GPU runners publish when an experiment is submitted or completed. No SGFs or neural-network weights are committed.

Production now uses GPU-only analysis. A single T4 allocation (`g4dn.xlarge`, 4 vCPUs / 16 GB RAM / 16 GB VRAM) runs quick analysis at **32 visits**, then deep analysis at **up to 3,000 visits**. Both use the latest official model, 16 analysis threads, one search thread and NN batch size 32. Every pass downloads the selected model fresh; weights are never saved to S3 or cached across passes. The earlier **1,000-visit** 321-move production validation at `/game/2026100618` delivered all 322 quick positions in **3m17s from SQS enqueue**. Deep results arrived in **18m15s from the same enqueue timestamp**. The conservative estimate for the complete shared GPU allocation was **$0.28**, before small API/storage/log usage. The final production report contains the paired measurement.

Queued GPU work gets a capacity check after three minutes. If it is still waiting, cancellation must be confirmed before a replacement is submitted to the GPU fallback pool, using the same model and visits. The first fallback is an independent capacity-optimized Spot queue using T4 (`g4dn.xlarge`) or A10G (`g5.xlarge`), with a separate approved four-vCPU quota. If that job remains queued for another three minutes, confirmed cancellation precedes a switch to the A10G On-Demand queue. The worker reads `nvidia-smi` to record the GPU and matching instance type actually selected. Spot interruptions enter the same bounded retry path. A job that starts during cancellation stays in place, avoiding a second paid worker. A10G is a fallback because its earlier capacity wait was variable, despite faster engine processing. If the A10G On-Demand fallback is still unavailable after fifteen minutes of queueing, the queued job is cancelled and enters the same bounded delayed-retry workflow. Running analysis is not interrupted by this capacity check. There is **no CPU fallback**. Failed jobs get at most two later retries, five minutes and then fifteen minutes after failure. Retries alternate GPU pools and skip completed passes; the browser displays errors, retry timestamps with timezone and countdown. S3 compare-and-swap claims, deterministic Batch names and submission recovery prevent ordinary duplicate deliveries from launching paid duplicates. Worker ownership tokens reject stale attempts. A delayed SQS control queue handles capacity checks and retries; Lambda never waits for the analysis.

After Ireland approved an eight-vCPU G/VT quota, two cold full-game workflows ran concurrently. Quick totals were **3m30s and 3m31s**; 1,000-visit T4 deep totals were **16m43s and 17m37s**, all measured from SQS enqueue. Both GPU workers retired automatically. Paired costs including CPU tasks and complete GPU allocations were conservatively estimated at **$0.26 and $0.29** before small API/storage/log usage. Stage timings and allocation details are in `cloud/benchmark-concurrency-summary.json`. The test also caught and fixed the IAM permission required for an unqualified latest-revision CPU job-definition ARN; the two unsubmitted failed startup attempts did not run compute and are excluded from public benchmark results.

Total waiting time starts at SQS enqueue and includes queueing, capacity acquisition, startup, model downloads, analysis and saving. The replay page shows elapsed total while pending, then a fixed completed total alongside engine time. Benchmark experiments show both total and processing time; manual worker experiments start at Batch submission, while workflow experiments use the original SQS timestamp. Quick results must meet a five-minute end-to-end target. Deep results target one hour, with two hours as the maximum waiting expectation. Concurrent uploads and future latest models can increase waiting. The UI reports actual times without hiding queue delay.

Historical development records were disposable; production records are protected. Failed/stopped benchmarks remain only in the internal spend catalog. The US$30 development/debugging cap covers all CPU/GPU runs, builds, setup, idle allocation and other service use. Production aims for both analyses below US$1 per game. Cost estimates are not final invoices; AWS billing data can lag.

## Move review and recommended lines

New analyses retain KataGo's ranked `moveInfos` candidates and principal variations in the existing S3 result files (schema version 2). Each position stores up to eight leading candidates, plus the played move if it was searched outside that set, and at most twelve PV moves per candidate. The engine request uses `analysisPVLen: 11` (the first candidate move is additional). Visits and compute settings are unchanged; viewing suggestions starts no paid job.

Move review is on by default and remembers the viewer's choice locally. At recorded move N, the board markers and comparison table suggest move N+1 from the analysis of displayed position N, for its player to move. The separate rating of recorded move N compares candidates from its parent position N−1. Best means KataGo's order-zero move, rather than a mathematically perfect move. Point loss is computed from the played player's perspective. Good / Inaccuracy / Mistake / Blunder use ≤0.5 / ≤2 / ≤5 / >5 points. When the played candidate has fewer than max(2, 3% of the best candidate's visits), the following analysed position supplies the played evaluation and the rating is marked estimated. All quick ratings are preliminary. Up to three next-move candidates within one point and five win-percentage points of the engine's best are offered, excluding underexplored alternatives; the best candidate is always included.

The comparison table includes up to three recommended moves and the recorded next move, even when that move is poor. The recorded row has a warm highlight and a Played badge. It shows quality, absolute point advantage in a badge coloured for the leading side, and Black/White winning percentages side by side; insufficiently searched recorded evaluations use the following position and show ≈. Missing values remain —. Click a recommendation row to pin its full stored continuation as numbered stones; click that selected row again to restore the original board. On desktops with a fine pointer, hovering previews the line and leaving restores the previous board or pinned preview. The table remains mounted and keeps its position throughout these previews. Table scores still describe the original analysed position. Explore line starts step-by-step exploration; clicking a board recommendation directly starts at its first move. Available saved replies then appear on the board and as buttons, numbered for the next step of the explored sequence (for example, 7 after moves 1–6); alternative replies share that next-step number. When the explored moves exactly follow a recorded path, candidates from that position’s existing analysis can supply further replies; otherwise only matching stored PVs are used. No future scores are invented, and a missing or exhausted PV is stated explicitly. The Played badge advances the record. Arrow keys or buttons retrace the line. Left/right also retrace manually played preview moves, preserving forward history within the preview. Returning to the variation’s origin automatically restores recorded replay; the next right arrow follows the game again. Chart focus respects variation arrows. Return to record restores the selected recorded move. Previews do not change the SGF or request new analysis. The browser enforces simple ko for Japanese/Korean rules and positional superko for other supported rules while replaying; a line stops safely if it cannot be reproduced. Older analyses without candidates remain readable and show an explanation, without automatically launching paid work.

Full-game move-review validation used the representative 321-move game at `/game/2026100617`. Quick analysis arrived in **2m59s** and T4 deep analysis in **18m31s**, including queue/setup. All 322 positions in each pass retained suggestions. All 588 quick and 672 displayed deep alternatives replayed legally, including twelve-move deep lines. Browser verification matched the first 100 recorded boards and a complete twelve-move alternative, checked the saved toggle, mobile chart placement, return to record and manual deep refresh. Both jobs succeeded and the GPU instance retired automatically. See `cloud/ai-review-validation.json` for the test evidence and conservative allocation costs.

## Protected production storage

`WeiqiStorage` owns the existing S3 record bucket, its SSL-only policy and the DynamoDB game table. They were moved intact with CloudFormation stack refactoring; no bucket or table was recreated. `WeiqiSite` and `WeiqiGpuBenchmark` hold site/API and temporary compute resources. The obsolete `WeiqiFargate` stack is removed. All stacks remain in Ireland, apart from CloudFront’s required existing global certificate.

Storage has stack termination protection, `Retain` deletion/replacement policies, S3 versioning, DynamoDB deletion protection and point-in-time recovery. `cloud/storage-stack-policy.json` denies CloudFormation replacement/deletion of the bucket or table. A direct data edit still requires normal care; stack protection is not an immutable backup. The harmless `StorageAnchor` CloudFormation handle supported the migration and has no running compute.

Deploy with CDK, then publish assets. After first creation or migration, apply the committed policy with `aws cloudformation set-stack-policy --region eu-west-1 --stack-name WeiqiStorage --stack-policy-body file://cloud/storage-stack-policy.json`. Do not disable storage protection during compute cleanup. Back up or migrate the entire bucket including ID/upload mappings and daily allowance files.

## Stronger deep analysis and printable reports

New production requests use at most 3,000 deep visits. For more than 321 moves, the limit scales as floor(3,000 × 322 / positions), keeping the processing estimate near the measured full-game envelope. Quick remains 32 visits. The completed 321-move production benchmark at `/game/2026100620` delivered quick results in **3m28s** and 3,000-visit deep results in **45m35s**, both measured from the original SQS enqueue and including queue/setup. The conservative estimate for the complete shared T4 allocation, including automatic worker retirement, is **$0.48**, before small API/storage/log usage. Cloud queues, newer models and retries can change time/cost. Actual configuration and timing remain visible. Older saved results are not automatically reanalysed.

Replay highlights next-move candidates directly on empty board points: blue for the engine's first choice, green for similarly strong alternatives, labelled A/B/C to match the table. Markers and table rows recommend the next move for the player to move from the displayed position. Click a marker to begin exploring its saved continuation from that board, with normal captures; each available saved follow-up is shown on the next position. The next recorded move has a triangle coloured by its rating: green best/good, yellow inaccuracy, orange mistake, red blunder, grey unrated. When it matches a recommendation, the triangle keeps its A/B/C letter. Clicking the triangle advances to that recorded move. Triangles hide in AI/manual previews and when suggestions are off; passes have a text notice instead. The last recorded move’s quality ring and rating still use its preceding position. The default-on move-review toggle also hides board markers. Recorded stones retain quality rings and remain unchanged.

After deep completion, the AWS Batch SUCCEEDED event invokes the existing GameHandler Lambda to build/cache the versioned report JSON in protected WeiqiStorage. It validates the completed job ID, SGF hash and complete main-line coverage; stale events are ignored. User report API requests only read that cache and never generate a report.

The completion handler sends a message to a CloudFormation-managed FIFO report queue. One message group serializes preparation without a reserved Lambda slot. A separate Node.js report Lambda (2 GB memory, five-minute timeout) uses pinned serverless Chromium, Puppeteer and the bundled Noto font to prepare **English and Chinese HTML views and fixed A4 PDFs** from that saved JSON. It never starts an AI/GPU job. The queue retries failures twice (three deliveries total), then moves the message to a dead-letter queue. Preparation records preparing/failed status; ready is published only after both languages’ HTML and PDF files have been saved. Repeated events reuse ready files with the same source-report key and renderer version.

Prepared files live under `prepared-reports/<game-id>/<renderer-hash>/` in the existing retained, private site S3 bucket, delivered through its existing CloudFront OAC. The uncached `prepared-reports/<game-id>/index.json` manifest selects immutable completed files. Original SGFs, analysis and source report JSON remain in protected WeiqiStorage. Report opening, language switching and Save PDF retrieve saved files directly through CloudFront; no generation Lambda or browser PDF composer runs on interaction. Save PDF is an ordinary file download. Old completed records require an explicit completion-event backfill before using the new viewer; viewing does not perform lazy generation.

After the title page and contents, the report opens directly with game-wide point advantage and winning chances, before comparing move quality, typical point loss, fixed move ranges and the error timeline. These **six graphs** use direct leader labels, neutral reference lines, move/point axes, quality thresholds and labelled error spikes. Under each graph, a single takeaway and compact calculation note replace long explanatory paragraphs. Loss-concentration, loss-distribution and average win-loss graphs are omitted to reduce overlap. All rated move qualities remain in the game statistics; missing evaluations do not become zero-loss moves.

Key moments lists **five worst bad moves per side** in compact tables, ranked by point loss, with win-probability loss and direct game links. The first three are highlighted and link to their later **detailed board reviews**, with played-board diagrams and numbered best continuations. If fewer moves qualify (>0.5 points, excluding best/good moves), it shows those available. The document includes a metadata-rich title page, game link, numbered contents, running headers/footers, internal PDF links and section bookmarks. Kyu/dan estimates are omitted; no PDF configuration or exercise options are exposed.

Renderer dependencies are pinned in `backend/report-renderer/package-lock.json`. `npm run build:report-renderer` packages every rendering asset and derives a content version; the CDK stack runs this before packaging the Lambda. Chromium produces searchable text and vector charts on fixed A4 pages. Sections fit one page each; PDF preparation checks the actual page count against the contents and converts contents hyperlinks into internal page destinations. Browser PDF composer dependencies have been removed. Local saved-HTML preview uses `PREPARED_REPORT_DIR`; an isolated local Chromium process can test the same background renderer through `CHROME_EXECUTABLE`.

Production PDF validation (2026-10-06): both English and Chinese downloads match the prepared S3 files exactly. Each sample has 15 A4 pages, searchable text, vector charts, internal contents/review links and section bookmarks. The duplicated game-summary page has been removed; metadata stays on the title page and reading guidance accompanies each graph. The updated reader has six graphs, ten key-moment rows and three board reviews per side; desktop and 390-pixel mobile layouts have no horizontal overflow. All 11 completed existing records were prepared with the latest renderer. Graphs use the replay chart palette: grey canvas, dark Black and outlined white White; point-advantage and win-probability graphs fill the area around zero and 50% respectively. Move-quality categories retain their green/yellow/orange/red meanings. The report viewer uses the app navigation and saved language preference, with Save PDF as the only extra header action. Evidence: `cloud/report-chart-style-validation.json` (latest presentation), `cloud/report-summary-removal-validation.json` (page layout) and `cloud/prepared-report-files-validation.json` (original export validation).


## Public-site safeguards and release evidence

### Project spending safeguard and administrator commands

Key deployment settings live in [`configs.yml`](configs.yml): Ireland region, project tag, monthly budget, daily AI quota, quick/deep visits, capacity fallback delay and job timeout. After changing them, run `make deploy-infra` (and `make publish` for website changes). No recipient email is configured or stored in the repository; notifications are disabled as requested.

`WeiqiBudget` is a CloudFormation-managed **$50 per calendar month** actual-cost budget and **$15 per UTC day** project budgets. Supported resources across all Weiqi stacks carry `Project=Weiqi`; Batch queues/environments use CloudFormation custom tagging calls to avoid replacement, and GPU instances/volumes receive tags through the launch template. Billing uses the existing `service` tag, including historical Weiqi worker variants. The stack activates that billing tag. Tag activation/reporting can take up to 24 hours; earlier unallocated costs or unsupported/shared resources may not appear. Credit/refund amounts do not hide underlying usage spend.

The budget's private SNS alert, backed by a five-minute reconciliation check, latches `control/ai-spending.json` in the library bucket. The private guard disables the three owned GPU queues and terminates pending/running jobs. API/dispatch guards stop new analysis, capacity fallback and automatic retries; saved games and completed quick/deep results remain available. GPU capacity retires through Batch's existing zero-minimum scaling. Reading/storage charges continue. AWS billing is delayed: this reduces further AI spend, **not a hard $15/day or $50/month bill ceiling**. The $30 development allowance remains separate.

From the project directory, using your AWS CLI credentials:

```sh
make ai-status   # Show pause status and whether this month's budget is exhausted
make ai-check    # Read-only check of the budget and active GPU jobs
make ai-resume   # Re-enable cloud AI, including quick position analysis
```

If `ai-resume` reports `daily_budget_exceeded` or `monthly_budget_exceeded`, increase the corresponding `budget.dailyUsd` or `budget.monthlyUsd` in `configs.yml` and run `make deploy-infra`, or wait for the next UTC day or calendar month. Then run `make ai-resume` again. It refuses to resume above the budget so the next reconciliation does not immediately stop AI again. Resume is manual, including at the start of a new month. Previously stopped analyses are not automatically restarted, avoiding an unexpected paid backlog. These commands invoke an IAM-only Lambda; there is no public pause/resume endpoint.

Production has SGF/body limits, revision-conditioned edits, idempotent publication, ten daily AI slots, 100 new saved records per London day, and a shared 120-mutation/minute limiter using one bounded DynamoDB row. API concurrency uses the account’s regional Lambda quota (currently ten), without a reserved allocation. CloudFront sets CSP/HSTS/frame denial/nosniff on the app and API. Private S3 and IAM-authenticated function URL origins reject unsigned access. These controls do not prevent deliberate public editing, quota consumption or all traffic charges. Source visibility is not authentication; no credentials are shipped to browsers. See `/security` for the threat model and residual risks.

Local validation files record this release’s official Ireland compute prices, production route/security checks, dependency audit, private-origin checks, saved-game AI completion and bilingual PDF validation. These generated files are kept out of the public repository. `npm test` includes draft branch/publication/conflict checks. Local previews now persist live state and the shared draft under `LIBRARY_DIR`, separate from production.

Recording details are required and populated automatically for new drafts and missing SGF metadata: Recorded game, Unnamed black player, Unnamed white player, local date, Japanese rules and 6.5 komi (0.5 for imported handicap records without komi). Existing metadata is preserved. Handicap (0–9 fixed stones) is editable before the first recorded move and sets White to move with handicap stones. There are no setup-tool or initial-player selectors. Clear board keeps metadata; single-move deletion/insertion keeps downstream moves and their recorded colors, replaying every affected variation atomically and rejecting illegal continuations. Selecting a variation automatically promotes it; Save game saves that complete main sequence after confirmation and clears the draft. No draft-download control is shown.

Record-game rotation is a local view preference in 90° steps. Shared BoardView positions and coordinate rails rotate together; board clicks keep canonical SGF indices and keyboard focus follows the visual direction. Rotation does not modify the public draft or saved SGF.

The recording controls sit below the game tree. Reposition move changes the selected node’s coordinate, keeping its color, comments and continuations with atomic replay validation. Pass names the player whose move is being recorded (or corrected while repositioning).

A single prominent Open local SGF file button opens the file chooser; its native duplicate is hidden. Save game is followed by “AI analysis starts after saving”; confirmation explains that only the currently selected branch is saved.

Recording Game details remain visible in a fixed section, without an expand/collapse control.

Draft-saving status appears inline beside the recording title, without inserting or removing vertical space while autosaves run.

## Quick analysis on /analysis

The live page offers automatic Lambda photo recognition followed by lightweight Lambda KataGo (cloud only; the earlier browser-AI option and its benchmark page were removed). No four-corner marking is needed. The flow is two steps. Step 1 sets up the board: the page opens on an editable empty board, with an Upload photo / Upload SGF box above the edit and settings cards; a read photo, an SGF or a hand set-up all land on the same board (Black/White show the next colour and stones alternate as they are placed; only Delete (red-cross icon) removes stones and shows a red cross on hover; orange rings mark uncertain points; compare with the photo). Next to play (default Black) and komi are set in step 1, and an empty board can be analysed; step 2 shows only the analysis, with board markers coloured by the same rating as the table (blue best, green good, yellow inaccuracy, orange mistake, red blunder). Step 2 is one Analyse request. From step 2, tapping step 1 goes back to edit the stones. If a photo cannot be read, the board stays as it was and the photo is shown so the stones can be placed by hand. There is no SGF download on this page. After that, each move played on the board, including tapping an A/B/C candidate, triggers one more short request; continuations are previewed only from the suggestion table, and nothing runs in the background. Analysis always uses Chinese rules (area scoring), because a photo cannot show earlier captures or ko history; komi is 7.5 or 0.5. Photos, cloud positions and results are processed without saving them to S3 or DynamoDB. Only request hashes and short-lived quota/lease records are saved. Browser localStorage holds the single game sequence and selected position; photos and AI results are never saved there.

`configs.yml` controls memory, worker timeouts, cloud visits and the shared public allowance. The current public allowance reserves $0.003 per attempted recognition/AI operation against $3/day: 1,000 operations globally per UTC day, normally about 500 cloud photo-plus-AI pairs. This is a conservative request cap, not a measurement of actual cost. Two operations can run concurrently; worker timeouts bound the expensive processing. The small KataGo model gives approximate win rates and suggestions that differ from deep reports.

The $15 daily budgets track `Project=Weiqi`, with the already-active service billing tag as a legacy fallback while AWS discovers the Project tag. AWS billing/tag data is delayed, so no tagged budget can impose an exact instant ceiling on every CloudFront, storage or compute charge. Runtime/request caps provide an immediate extra limit on this public feature. The $50/month shutdown remains. After the next eligible budget period, use `make ai-status`, then `make ai-resume`; resuming is manual.

Photo recognition (7 October 2026, `tiled-colour-20261007`): Moku v4 detects stones on the whole board and on four overlapping crops. The grid is refitted to the stones, then stickers and wrong-coloured candidates are rejected. All four of the user's reference photos, checked against positions read by a separate paid tool, are read exactly, live and locally. A warm Lambda call takes about 7–8 seconds. The 48 lighting, blur and compression variants give 43 exact boards, up from 12. The page outlines doubtful points for checking. Four photos cannot establish general accuracy, so recognition remains experimental and users must check the board before analysis. Original photos are displayed only in memory for review. AI starts when the user clicks Analyse position. See `cloud/photo-recognition-real-20261007.json`; the public explanation is `/photo-recognition` (`src/photo-recognition.html`, rendered by `src/documents.js`).
