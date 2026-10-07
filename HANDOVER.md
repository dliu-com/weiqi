# Weiqi project handover for Copilot

Prepared 7 October 2026. Project: **DL Weiqi**, <https://weiqi.dliu.com>. Repository: `weiqi` within the user's `dliu.com` workspace. This note captures the user's latest decisions, the implementation, and the remaining work when transferring development from Codex to Copilot.

**Start with the current working tree, not just `main` or a fresh clone.** Many recent changes are modified or untracked, including the deployed `/analysis` feature, its backend/CDK stack, spending controls, replay improvements and benchmark scripts. The latest inspected commit was `6524aaf` (reset recording-board rotation). Do not reset, clean, discard or regenerate over this work. No commit or push was performed for this handover. Review `git status --short` before making changes.

## User goals

- A public Chinese/English 19 × 19 Go site that works well on phones and desktop: play a live game, record/import SGF, save immutable games, replay them, and review KataGo suggestions and reports.
- Saved full games receive quick analysis followed by deeper analysis, within controlled AWS spending. Review/report interactions should reuse saved results and should not silently launch more paid analysis.
- Documented full-game targets are quick results within five minutes, deep results within one hour (two hours maximum), and both passes below roughly $1 per game. These targets include queue/startup time and are not service guarantees.
- A separate `/analysis` page for discussing an offline game: import SGF or take/upload a board photo, get an approximate leader, point advantage, win rate and possible next moves, then play out or undo moves along one sequence.
- For that offline discussion, feedback should ideally arrive in **under one minute**, with **two minutes the maximum acceptable wait**. Approximate AI is acceptable; incorrect board recognition is not solved by deeper KataGo analysis.
- The user currently prefers **Lambda photo recognition + lightweight Lambda AI**, while retaining browser AI for comparison. Both options are live. The final choice should follow measured end-to-end latency, cost and real-photo accuracy.
- No manual four-corner marking. Automatic photo recognition remains the main unresolved feature: the user tested the supplied training photos on a phone and reported that none was correct.
- Prevent public abuse from causing a large AWS bill. Someone consuming all available public slots is an accepted risk. Bounded compute and spending matter more than preventing slot exhaustion.

## Coding and collaboration preferences

1. Keep changes focused on the requested behaviour. Reuse the existing site shell, board, engine, SGF and UI conventions; avoid unrelated features or redesigns.
2. Make concrete changes and verify them. Avoid unnecessary confirmation for routine, reversible work already covered by the request. Get approval for new spending commitments, destructive changes or actions outside the requested scope. Preparing this note does not authorize fresh production changes or GPU experiments.
3. Preserve manual edits and existing uncommitted work. Inspect current files before updating them. Treat the working/shared version as authoritative.
4. Follow `AGENTS.md`: routine changes need a few representative affected positions; reserve full-game replay for final pre-production validation. Keep checks proportionate and stop broad/repeated testing once the affected behaviour is verified. Prefer tests of meaningful behaviour over tests that merely mirror implementation.
5. Keep both Chinese and English UI text natural and consistent. Prefer simple controls and clear labels. Use `*` for mandatory fields; do not add redundant “optional” labels. Keep Game details expanded and visible.
6. Avoid layout shifts caused by temporary autosave/status messages. Do not add success banners the user asked to remove, such as “Cloud check passed. Edits saved.”
7. All pages, including `/analysis` and benchmark pages, should use the same header, navigation, language controls and responsive layout as the rest of the site. The menu includes User guide on every page, including the main page.
8. Use `configs.yml` in the project root for easily changed deployment settings. Keep executable logic in the existing source/build/CDK structure. Settings changes require deployment; this file is not a live control panel.
9. Provision project infrastructure through CDK/CloudFormation in **eu-west-1** and tag supported resources `Project=Weiqi`. Keep temporary experiments bounded and clean up their compute/storage. Do not add an always-on worker without an explicit cost decision.
   - **Deploy AWS resources only through CloudFormation** (CDK-generated stacks). Uploading content such as site files, runtime packages and container images to those resources is fine; creating resources by CLI or console is not.
   - **Usage-only billing:** assume extremely low traffic. Idle fixed monthly cost must stay **≤ US$2**; everything else must be usage-billed. Avoid always-on compute, NAT gateways, interface VPC endpoints, provisioned capacity, customer KMS keys, WAF, paid CloudWatch alarms/dashboards and action-enabled budgets unless the user approves them. `cdk/test/usage-billing.test.ts` checks the production stacks.
   - The October 2026 audit estimated idle cost at about **$0.30–$0.50/month**, mostly the two retained GPU worker images in ECR, plus S3 versions and the 5-minute spending-guard schedule. Notification-only budgets are free. Lambda logs use CloudFormation-managed log groups with 7-day retention instead of the deprecated `logRetention` helper.
   - Known exception: the site certificate still uses CDK's legacy `DnsValidatedCertificate` custom resource, matching the sibling dliu.com sites. Replacing it means swapping the production CloudFront certificate, so do that only as a deliberate change.
   - Push commits to `origin` by default.
10. Never commit private board photos, production SGFs, model weights, credentials, personal email addresses or generated deployment packages. `training image/` is intentionally ignored. The user does not want an email address anywhere in this repository and decided against project email notifications.
11. Use CLI/API access for AWS work. Do not inspect the signed-in AWS console unless specifically requested. The earlier exception was to draft an AWS Support request in Chrome for the user to submit. Chrome research belongs in a new or previously agent-created window; leave the user's own windows alone unless expressly directed.
12. Distinguish measurements, estimates, provisional labels and verified facts. Include upload/queue/startup time in user wait estimates. Emulators and desktop mobile emulation do not establish physical-phone performance. A returned board is not necessarily a correct board.
13. Generated CDK output became a disk-space problem on this Mac. Use temporary/output directories deliberately and remove disposable generated packages after use. Do not remove source, private test photos or saved games as “cleanup.” Temporary files are not a portable handover dependency.

## Completed product work and behaviour to preserve

### Play and saved library

- `/play` is one public live game, synced across devices; there are no accounts or player ownership controls. `/record` is one public recording draft. `/analysis` is a separate browser-owned workspace.
- Rules, captures, suicide prevention, superko, undo, passes, resignation and casual Chinese area scoring are implemented. Completed live games save to the library and start a fresh live board.
- Any game already in the library is immutable. Unsaved replay trial moves are allowed, but cannot change the saved SGF or replace its analysis with a different game under the same ID.
- Numeric IDs remain `YYYYMMDD01`, etc., in links, but S3 storage uses **`games/YYYYMMDD/01/`**, not `games/YYYYMMDD01/`. UUID legacy IDs are also supported. The library bucket is distinct from the static hosting bucket; resolve buckets through CloudFormation outputs/configuration.
- `reservations/<id>.json` allocates IDs atomically. `uploads/<upload-uuid>.json` remembers an upload's identity. Retrying the same upload reuses its ID and allowance; supplying different SGF content for that ID is rejected.
- `daily-analysis/YYYYMMDD/01.json` through slot 10 implement the global full-game quota using conditional S3 creates. It tries a bounded set of slots, rather than scanning every library record or maintaining a client-side count. Full-game dates/IDs follow Europe/London. The quota message includes the relevant date.
- Up to 100 new library records can be saved per London day. When AI is limited or paused, games can still save and replay. An upload retry must not trigger a second paid workflow.

### Record game

- Title, date, black/white names, rules, handicap, komi and result are required. Missing metadata is populated so the user can save without typing: `Recorded game`, `Unnamed black player`, `Unnamed white player`, local date and Japanese rules. Preserve supplied metadata.
- Date is the second field. Optional metadata includes black/white ranks (`BR`/`WR`), location (`PC`) and time control (`TM`/`OT`). Display ranks, location, handicap when nonzero, and explicit time-control format in the library/replay details.
- Rule choices are Japanese, Chinese, Korean and AGA only; Japanese is the default. Default even-game komi is 6.5 for Japanese/Korean and 7.5 for Chinese/AGA; handicap defaults to 0.5. Users can change komi.
- Handicap is an integer 0–9, editable before recording starts. **Handicap 1 means free first Black play on an empty board, with adjusted komi; no fixed centre stone.** Counts 2–9 use fixed placement and White next. Check all placements and rotated coordinates when modifying this logic.
- Result UI has three first-field options: Black wins, White wins, Unfinished. The second field is optional: blank for unknown reason, timeout, resignation or by points; selecting points requires a margin. Imported results are parsed into editable fields instead of showing “Keep original SGF result.” See the unfinished-result inconsistency below.
- Time control is optional: absolute/main time only, Japanese byo-yomi or Fischer increment. No Canadian overtime.
- One prominent coloured **Open local SGF file** button sits below the Record game heading; the duplicate native file button is hidden. No Download draft SGF, Initial player, Board tool or Make main branch button.
- Selecting a variation automatically makes that sequence the main branch. **Save game** saves only the selected main sequence; explain that scope. The help text is exactly “AI analysis starts after saving.” No “unfinished saves as Draw” explanation.
- Clear board, player-named Pass and Rotate board sit below the game tree. Rotation changes only the view/click mapping and resets for a new/cleared recording.
- **Edit sequence** keeps downstream moves, so correcting moves 50/51 does not require entering moves 52–100 again. Delete move, Insert moves and Reposition move belong inside its panel. Single-move deletion has no confirmation prompt; reposition hover uses the selected move's colour.
- Sequence edits exist only in page memory: refresh or Cancel discards them. There is no localStorage edit backup and no cloud autosave while this mode is active. Temporary invalid sequences may exist locally; **Apply edits sends the complete tree to the cloud**, which validates alternation, legality and variations before a revision-conditioned atomic draft write. Rejecting an edit leaves the saved cloud sequence intact. Do not silently recolour later moves to hide an alternation error.
- Ordinary draft edits autosave; status remains inline without shifting the layout. The public draft timestamp line and the cloud-check success message were removed.
- Stone-placement audio is shared across recording, live play and replay. Default volume is **10%**, adjustable and remembered in browser storage. A failed audio load must not prevent a move. The user wanted one natural stone click, rather than a repeated synthetic “da da da.”

### Saved AI review and reports

- Selecting a suggestion-table row previews its saved principal variation with correct relative move numbers. Clicking the selected row again restores the original position. Desktop hover previews temporarily and leaving the row restores the previous state.
- Clicking a board candidate explores its available saved continuation. Not every candidate has a follow-up; do not invent deeper evaluations or run new cloud analysis when exploring saved lines.
- The table shows move/quality, point lead coloured Black or White according to who leads, and Black/White win percentages side by side. Preview controls should clearly say they return to the original game position.
- Full-game analysis is GPU-only: quick 32 visits, then deep up to 3,000 visits, scaled down for very long games. AWS Batch capacity starts at zero and retires when jobs finish. Capacity fallback/retries are bounded and require cancellation/ownership checks so two paid jobs cannot race.
- Replay estimates include move count and queue/startup time. Preserve honest “estimate unavailable” states instead of moving expired finish timestamps forward forever.
- Completed deep analysis triggers saved report JSON plus background preparation of English/Chinese HTML and fixed A4 PDFs. Viewing a report, switching language or downloading PDF reads prepared files; it must not generate a report or launch KataGo on interaction.
- Report preparation uses the FIFO queue and pinned Chromium/Puppeteer renderer. Original records/analysis remain in protected library storage; immutable prepared HTML/PDFs are in the private site bucket. Renderer version changes require rebuilding assets and explicitly preparing affected old reports.
- Reports include metadata, six game-wide charts, five worst qualifying moves per side and detailed board reviews for the leading three per side, with searchable bilingual PDFs and contents/review links. Preserve measured data and preparation/version checks when changing presentation.

### Quick analysis on `/analysis`

- The page is deployed, uses the shared site layout and has a main-page entry. Its current user-facing name is **Quick AI analysis**, reflecting the cloud option.
- It accepts local SGF, camera input or an uploaded photo. It has board navigation and trial play, without `/play` clocks/game-ending controls. Only one sequence is retained; playing from an earlier position replaces its later moves.
- Browser storage restores positions/moves/settings after refresh. Photos and AI results are not saved there; downloaded browser model weights are cached. Clearing browser data removes the local game/model cache.
- Photos are compressed and transmitted to Lambda for automatic recognition in either AI mode. Cloud AI also transmits the position and available history. Browser AI runs locally. Neither path saves photos, game records or AI results in cloud storage; short-lived request hashes/quota/lease records are stored. Do not restore the earlier blanket claim that “everything is local.”
- The original photo is retained only in page memory and shown beside the detected board for corrections. **AI waits for Analyse position after photo review**, rather than automatically analysing the detector's output.
- Browser AI uses the pinned small KataGo model at 32 visits; Lambda AI uses the same model at 128 visits. Browser and native engine versions differ; these are rough mini analyses, not deep reports.
- A photo does not reveal past moves, ko history or earlier captures. This limits Japanese/Korean point estimates. SGF history can be supplied when available.
- `/analysis-benchmarks.html` compares six positions from `/game/2026100623`. Earlier desktop runs measured about 12 seconds for recognition + browser AI and 10 seconds for recognition + Lambda AI. These predate the latest grid correction/photo-review step and are not physical-phone guarantees. Quality comparisons had roughly 2-point mean lead differences and 10.7 percentage-point mean win-rate differences from full analysis.

## Cost controls and operations

Current values in `configs.yml`:

| Setting | Value / meaning |
| --- | --- |
| Project cost limits | $15 per UTC day; $50 per calendar month |
| Development allowance | Separate $30 total for AWS development/debugging |
| Full-game AI allowance | 10 new eligible games per London day |
| Quick feature allowance | $3/day conservative reservation allowance; $0.003 reserved per attempted photo/cloud-AI operation, allowing 1,000 operations globally per UTC day |
| Quick concurrency | Two worker leases; duplicate request UUIDs cannot invoke again |
| Recognition worker | 1,769 MB; 25-second Lambda deadline |
| Mini AI worker | 3,008 MB; 20-second Lambda deadline; 128 visits |

Recognition plus cloud AI usually consumes two quick-feature operations. These reservations are limits, not actual cost measurements. An operation can consume its allowance even if processing fails or capacity is busy.

Budgets use project tags, with the existing service tag as a legacy billing fallback. Alerts/reconciliation latch the spending-control object, disable owned GPU queues, stop jobs and block new cloud analysis. Resume is manual; stopped analyses do not automatically restart as a backlog. **AWS billing/tag data is delayed, so these are not instantaneous hard ceilings on every AWS charge.** CloudFront, rejected requests, storage and logs can still cost money after AI stops. Preserve fail-closed behaviour when safeguards are unavailable. Browser-only AI does not invoke cloud AI.

From the project directory with the user's normal AWS CLI credentials:

```sh
make ai-status   # Inspect pause status
make ai-check    # Read-only budget/job check
make ai-resume   # Deliberately resume eligible cloud AI
```

If the daily/monthly limit is exceeded, wait for the appropriate period or deliberately change `configs.yml` and deploy before resuming. Do not resume automatically or silently raise limits. No project recipient email is configured; the user will manage account-level email elsewhere.

The development ledger is `cloud/development-cost-ledger.json`; it contains conservative estimates, not a final invoice or an automatically current remaining balance. Audit running resources and existing allocations before starting paid experiments.

## Remaining work in priority order

### 1. Reliable automatic real-photo recognition

The deployed detector is **Moku v4, ONNX Runtime CPU on Lambda**, with our automatic grid fitting and conservative low-score stone recovery. The grid fix prevents some interior points from being selected as board corners, but it does not make the detector generally reliable. More CPU/GPU made the same model faster in earlier tests, not more accurate.

Six supplied real photos and 20 generated scenes have been tested. Only two real photos have complete **provisional assistant-created labels**, not independently verified ground truth. The other four must not be assigned an exact accuracy percentage. One remains rejected by the corrected automatic grid pipeline. Returning a board or matching stone counts is not proof of correctness.

Latest original-file model comparison:

| Pipeline | Clear provisional photo errors | Angled provisional photo errors | Exact generated boards |
| --- | ---: | ---: | ---: |
| Moku with grid fix | 0 | 2 | 15/20 |
| YOLOv8n stone patches with the same automatic grid | 0 | 11 | 20/20 |
| EfficientNet stone patches with the same automatic grid | 0 | 23 | 20/20 |
| image2sgf independent FCOS + EfficientNet pipeline | 0 | 18 | 20/20 |

The earlier resized/live-input test had 0 and 1 Moku errors; the original-file comparison has 0 and 2. Do not combine these as one benchmark. Alternatives were tested locally and **were not deployed**, because real-photo evidence did not establish an improvement. The temporary 1 GB inference runtime was removed afterwards; private results/checkpoints may remain in `/tmp` on this Mac, but are not guaranteed to survive or exist on another machine.

Next work: evaluate stronger real-photo models or improve/train the detector using sufficiently diverse labelled real data. Keep evaluation photos separate from training/tuning, mark uncertain labels, and count exact boards, missed stones, extra stones, wrong colours and failures. Synthetic scenes from known SGF positions are useful regression tests, but cannot establish real-photo readiness. The user previously mentioned Kifu Snap; its existence is not proof that its model/API can be integrated or is better on these photos. Review availability/licensing before integration, and obtain authorization before sending private photos to a new third-party service.

Acceptance should include the user's physical phone and supplied real photos, automatic corners, realistic upload conditions, review/correction usability, and total time to useful analysis within the one-/two-minute target. Earlier Android browser/emulator tests processed photos but did not establish correct recognition. Continue to label the feature experimental until the real-photo results support stronger wording.

Evidence and reproducible scripts:

- `cloud/photo-recognition-benchmark-20261007.{json,md}` — Lambda/CPU/GPU cost/startup tests and original accuracy comparison; historical baseline.
- `cloud/photo-detection-fix-20261007.json` — deployed grid correction and live checks.
- `cloud/alternative-photo-models-20261007.json` — latest private original-file model comparison, limitations and local timings.
- `scripts/photo-benchmark/README.md`, `patch_models.py`, `image2sgf_worker.py`, `score.py` — rerun instructions. Labels must enter scoring only, never inference.
- `photo-analysis/SOURCES.json` — pinned model/source revisions, hashes and licensing. The standalone recognition integration is AGPL-3.0-only; browser/native KataGo components have their recorded MIT terms. Preserve the corresponding-source download when publishing modifications. image2sgf was a private experiment; its upstream licensing must be resolved before product integration.

### 2. Recheck both quick AI modes on real phones

Keep browser and Lambda options available while making the final decision. Rebenchmark after recognition changes, with exact corrected boards as input for AI-quality comparisons, and also measure the complete photo-to-result interaction. Separate detection errors from AI errors. Include first model download/cache behaviour, cold starts, warm runs and upload time; report small samples as observations, not latency guarantees. Never hide the photo-only missing-history limitation.

The account exposed a 3,008 MB Lambda memory cap during earlier experiments. A support request was drafted and the user submitted the support workflow; final quota approval is unconfirmed. Current workers fit beneath that cap. Do not assume it increased or open the AWS console to check without authorization.

### 3. Resolve result semantics and documentation drift

The latest user request is three winner options including **Unfinished**, not Draw. Currently `src/editor.js` labels select value `0` as Unfinished, while `recording-tree.js` defaults/serializes `RE[0]` and `game-result.js` displays that value as Draw. Imported `?`/`Void` results also exceed the current three-choice editor UI. Reconcile editing, SGF preservation, validation and replay semantics deliberately; do not silently rewrite existing library games.

Some older README paragraphs describe flat numeric S3 folders, fixed handicap 1, unfinished-as-Draw or historical deployment flows. Use current code, `configs.yml`, this note and the user's latest decisions to reconcile those passages. Preserve historical benchmark settings instead of presenting old 1,000-visit results as the current 3,000-visit configuration.

### 4. Finish the repository transfer and regression check

Review the dirty/untracked changes before committing or pushing. Include required new source, CDK files, tests and lockfiles; exclude generated assets, private data and credentials. Some local validation files mentioned by README are not part of a portable clone. Do not upload `/tmp` wholesale.

Run focused checks for the behaviour being changed, then the required broader release checks before deployment. Verify bilingual mobile layout, edit-mode cloud validation, immutable library saves, quota/idempotency/spending guards, AI continuation numbering/toggling/hover, and report download behaviour when those areas change. Use representative positions during routine work; no need to run paid full-game analysis for a documentation-only change.

## Source map

| Area | Start here |
| --- | --- |
| Shared shell and board | `src/site-shell.js`, `i18n.js`, `board-view.js`, `board-geometry.js`, `engine.js`, `styles.css`, `site.css` |
| Live play | `src/app.js`, `play.html`; `backend/game-service.js`, `handler.cjs` |
| Recording editor | `src/editor.js`, `editor.html`, `recording-tree.js`, `recording-sequence-edit.js`; cloud validation in `backend/draft-service.js`, draft API/atomic writes in `backend/handler.cjs` |
| Immutable library / quotas | `backend/library-service.js`, `library-handler.cjs`; `src/library.js`, `library-api.js` |
| Saved replay and AI lines | `src/record.js` (replay, despite its filename), `ai-review.js`, `replay-navigation.js`, `evaluation-chart.js` |
| SGF metadata | `src/sgf.js`, `recording-tree.js`, `game-result.js`, `time-control.js` |
| Sound | `src/stone-sound.js`, `stone-placement.mp3` and its licence file |
| Quick-analysis browser code | `photo-analysis/src/main.js`, `position.js`, `local-ai.js`, `cloud-api.js`, `models.js` |
| Quick-analysis page/build | `src/photo.html`, `photo.css`, `analysis-benchmarks.html`; `scripts/build-photo-analysis.mjs`; generated `src/photo-assets/` is ignored |
| Quick-analysis cloud | `backend/position-handler.cjs`, `backend/position/{recognize,moku,grid,analyze}.py`; `cdk/lib/weiqi-position-stack.ts` |
| Full-game GPU workflow | `backend/gpu-production.cjs`, `gpu-fallback.cjs`, `cloud/gpu/`, `cdk/lib/weiqi-gpu-benchmark-stack.ts` |
| Prepared reports | `backend/report-renderer/`, `backend/library-handler.cjs`, `src/report.js`, `report.css`, `scripts/build-report-renderer.mjs` |
| Infrastructure and budgets | `cdk/bin/cdk.ts`, `cdk/lib/weiqi-{site,storage,budget}-stack.ts`, `project-config.ts`, `backend/budget-guard.cjs` |
| Admin/build/publish | `Makefile`, `scripts/ai-control.mjs`, `build-position-runtime.py`, `publish-site.sh` |

## Development and deployment commands

Prerequisites: Node.js 22+, npm, Make, Python/pip for recognition tooling, AWS CLI and authorized credentials for cloud operations. The browser and CDK have separate locked npm dependencies.

```sh
make install
make serve              # Local preview, normally http://127.0.0.1:4174
node --test tests/recording-sequence-edit.test.js tests/recording-details.test.js
node --test tests/local-analysis.test.js tests/position-service.test.js
python3 tests/position-grid.test.py   # Requires NumPy and Pillow
make test               # Python cloud, Node and CDK suites; use for release checks
make build-local-analysis
make diff               # Inspect proposed infrastructure changes
```

Local previews can persist a library/draft under `LIBRARY_DIR`; keep that data outside Git and separate from production. Cloud photo/AI calls need their actual API or a deliberate local test setup; a local static preview alone does not reproduce the cloud services.

For an authorized cloud-worker release:

```sh
make prepare-position-runtime  # Builds pinned Linux packages, uploads to private library bucket,
                               # updates cloud/position-release.json
make diff
make deploy-infra              # CDK deployment and storage stack policy
make publish                   # Rebuilds browser assets and publishes static files
```

Plain `make` defaults to **deployment** and invokes install, tests, infrastructure deployment and publish. Do not run it expecting a local-only build. `make publish` uploads to the live site and invalidates CloudFront. Rebuilding browser assets does not deploy Python Lambda changes; deploy workers through the release keys/CDK as well. Do not hand-edit generated bundles as the source of a fix.

Production stack names: `WeiqiStorage`, `WeiqiSite`, `WeiqiGpuBenchmark` (despite its historical name, it serves production GPU analysis), `WeiqiBudget`, and `WeiqiPositionAnalysis`. Historical CPU/Fargate source remains, but current deployment flags disable Fargate/CPU dispatch. Browser requests use **CloudFront → IAM-protected Lambda Function URL**; API Gateway has been discussed but not added.

`WeiqiStorage` has termination protection, retained bucket/table policies, S3 versioning, DynamoDB deletion protection/PITR and `cloud/storage-stack-policy.json`. Do not replace or delete it while changing compute. Migration/backups must include `games/`, `uploads/`, `reservations/`, daily allowance/control data and the library index, not just SGFs. Inspect actual stack outputs and deployment diffs before any infrastructure change.

The handover note and Copilot instruction pointer are documentation only. They do not claim a fresh AWS inventory audit or a newly completed full release test.
