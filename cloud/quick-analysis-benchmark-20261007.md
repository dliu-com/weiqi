# Quick position analysis benchmark — 7 October 2026

Both options are live at https://weiqi.dliu.com/analysis; use the Analysis mode selector. Device-specific comparison: https://weiqi.dliu.com/analysis-benchmarks.html. No four-corner marking. Both options share the automatic Lambda Moku detector.

These measurements use Chrome 154 on the development Mac, **not a physical Android phone**. The end-to-end waits are individual page runs, including browser JPEG compression, upload, detection and AI. They are not a latency guarantee. Browser inference uses the small pinned model/32 visits; Lambda uses that same model/128 visits.

| Option | Observed photo → result | Estimated AWS / 1,000 photos, warm | All cold | Mean lead difference from full report | Mean win-rate difference |
|---|---:|---:|---:|---:|---:|
| Lambda recognition + browser AI | 12.13 s | $0.12 | $0.27 | 1.99 points | 10.6 percentage points |
| Lambda recognition + Lambda AI | 10.05 s | $0.21 | $0.43 | 1.95 points | 10.7 percentage points |

Cost estimates use public wall time conservatively as worker + gateway billing time, standard x86 Lambda rates without free-tier discounts, plus a request/storage/log allowance. CloudFront requests/transfer, model delivery and ongoing storage are additional. These are estimates, not an AWS invoice. See [AWS pricing](https://aws.amazon.com/lambda/pricing/). No always-on server or GPU is required.

Three forced cold public requests per worker: recognition 7.2–8.6 s, cloud AI 2.7–2.8 s. Six warm requests each: recognition 3.0–3.7 s, AI 1.6–1.9 s. Models and dependencies are packaged in advance; request startup does not install them. Combined cold components are about 11 seconds before browser compression/upload. The live page stops a request that exceeds its time limit.

## Detection

- Clear real photo `PXL_20240407_104618235`: 361/361 intersections correct against assistant visual labels, also checked through the live Chrome upload flow.
- Angled real photo: 7 errors out of 361 intersections (4 missed stones, 3 extra); no colour swaps.
- The references are provisional assistant labels, not independently verified by the owner. Four other real photos have no complete ground truth: one is cropped, two have observed grid alignment errors, and one is rejected. No general real-photo accuracy percentage is claimed.
- Twenty deterministic rendered images from four known legal positions: 14 exact boards, four accepted with errors, two rejected. Rejected images are not included in the intersection accuracy denominator. Generated flat/perspective/shadow/blur/low-resolution scenes are not real phone photos. Labels were not supplied to inference.

## AI agreement

Six exact SGF positions at moves 20, 80, 160, 240, 300 and 321 from game 2026100623 are compared with its 3,000-visit report (larger tf3-b11c768 model). The benchmark page sends the exact SGF history, so these comparisons are isolated from detection errors. Both mini engines matched the leading side at all three positions where the reference lead exceeded two points. Browser leading-side matches: 5/6; cloud: 4/6. First-suggestion matches were limited; review the per-position tables. This is agreement with one stronger report, not proof of correct play or general AI accuracy.

Photo-only cloud analysis of the same six exact boards, with no history: mean lead difference **3.74 points**, maximum **9.31 points**. At move 240 the full report favours White by 8.7, whereas the small photo-only engine slightly favours Black. Earlier captures and ko/history are absent; Japanese/Korean point estimates can be misleading. Exact stone detection alone cannot recover that information.

## Safeguards and persistence

The tagged project has a $15/day actual-cost shutdown and retains its $50/month shutdown. Project tag activation is attempted when AWS discovers it; already-active legacy service tags cover the current Weiqi stacks in the interim. AWS Budgets typically updates 8–12 hours after the previous update, so this cannot enforce an instantaneous $15 hard bill ceiling across all charges. See [AWS budget timing](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

Immediate additional limits: 1,000 public operations worldwide per UTC day (a conservative $3 allowance reserving $0.003 per attempted detection/cloud AI request), two concurrent workers, 25-second recognition/20-second AI worker deadlines. A cloud photo-plus-AI pair usually uses two operations; browser AI uses no cloud AI operation. Duplicate UUIDs cannot invoke again. Malformed inputs and unavailable safeguards fail closed. CloudFront, rejected API requests and storage still incur charges. Budget status is private and can be inspected with `make ai-status`; after the spending period resets or limits are raised and deployed, use `make ai-resume`. Resume is deliberate, not automatic.

Photos, game records and results are not persisted in the cloud. Only quota/lease data and request hashes are retained briefly. Browser storage saves one game sequence/position; refresh restores it without photo or AI results. The browser caches its model.

Option 2 is the default for consistent latency across devices. Both versions are suitable for trying rough suggestions; detection corrections and missing history remain material limits. Use the full report for serious review.
