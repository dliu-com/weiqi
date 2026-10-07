# Photo recognition benchmark — 7 October 2026

Lambda is the best hosting fit for occasional photo recognition within the current budget. Automatic detection ran within 11 seconds in these Lambda tests, including cold starts. Accuracy remains the limiting factor: changing compute hardware did not improve the baseline model's predictions. This experiment did not deploy a photo API or change the live `/analysis` page.

## Method

All AWS tests ran privately in Europe (Ireland), `eu-west-1`, using temporary resources tagged `Project=Weiqi`. Recognition received photographs and sample identifiers only, with no supplied corner coordinates or reference board positions. This measures photo recognition, not KataGo analysis.

The baseline used Moku v4, pinned by SHA-256 in `scripts/photo-benchmark/moku_worker.py`. It performs automatic corner detection, rectification, then stone detection. Lambda and CPU EC2 used ONNX Runtime 1.20.1; GPU EC2 used 1.20.2 with the CUDA provider verified. A separate GPU experiment evaluated [noword/image2sgf](https://github.com/noword/image2sgf)'s v0.07 FCOS corner detector and EfficientNet stone classifier. Its source repository has no explicit licence file; this was a private evaluation, and licensing must be resolved before product integration.

The synthetic set contains 20 deterministic images from four legal positions at moves 20, 80, 160 and 321 of game `2026100623`. Captures are applied by the existing SGF engine. Each position has flat, perspective, shadow/lighting-gradient, blur and low-resolution/JPEG variants. These renders have exact labels, but are simpler than real photographs and cannot establish real-world accuracy.

All six supplied real photographs were processed automatically. Two boards were visually labelled and checked against enlarged, rectified views before comparing model predictions. These are assistant-created references, not independently verified human ground truth. The other four photographs have no reliable complete reference and are excluded from numeric accuracy claims. Private photos, board maps, weights and raw results are kept outside the repository.

## Measured latency and cost

| Configuration | Cold / start to first result | Warm result | Estimated compute + request cost per 1,000 photos |
|---|---:|---:|---:|
| Lambda, 1,024 MB | 10.34 s, one cold test | 4.12–4.14 s, two tests | $0.068 warm / $0.162 all cold |
| Lambda, 1,769 MB | 7.16 s, one cold test | 2.49–2.50 s, two tests | $0.071 warm / $0.188 all cold |
| Lambda, 3,008 MB | 5.74–6.06 s, three cold tests | 1.72–2.34 s, three tests | $0.092 warm / $0.261 all cold |
| CPU EC2, c6i.xlarge, 4 vCPU / 8 GiB | 11.73 s from starting a stopped instance with cached runtime/model, one test | 0.83–1.15 s, three tests | $0.1824 per instance-hour; one isolated fresh request incurs at least 60 seconds of instance billing |
| GPU EC2, g4dn.xlarge, NVIDIA T4 | 248.40 s from fresh official DLAMI launch, including dependency installation/model downloads, one test | 0.35 s for the clear reference photo | $0.587 per instance-hour; startup and idle time are also charged |

Lambda figures are synchronous SDK round trips from this Mac to a private function. VM warm figures are local handler durations, so they are not directly comparable client round trips. All photos were already in the region or on the VM disk. None of these figures includes a phone's upload time, public API overhead or page rendering. Small samples are observations, not latency guarantees or p95 measurements.

Lambda cold tests included a new execution environment, imports, model download, initialization and inference; there was no provisioned concurrency or SnapStart. Estimated Lambda cost uses the actual AWS billed duration, including initialization, at $0.0000166667 per x86 GB-second plus $0.20 per million requests. It excludes storage, transfer, logging, any public API, taxes and free-tier allowances. See [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/).

For VMs, keeping the tested CPU configuration warm for 730 hours costs approximately **$137.86/month**, including its 12 GB gp3 volume and one public IPv4 address. The GPU configuration with a 45 GB gp3 volume costs approximately **$436.12/month**. Regional Linux On-Demand prices were retrieved from the AWS Price List API; gp3 is $0.088/GB-month and public IPv4 is $0.005/hour. These are configuration-specific estimates, not the minimum possible server cost. Both warm configurations exceed the project's $50 monthly threshold.

The original GPU instance stalled while stopping. Its saved results remained available, and it was terminated. A replacement supplied the measured fresh startup above. A cached GPU restart was **not successfully measured**, and the 248-second fresh bootstrap is not a measurement of a prepared production image's cold start. GPU model initialization and first CUDA execution alone also took roughly 27 seconds in the replacement process.

## Accuracy

| Recognizer | Exact synthetic boards | Exact visually checked real boards | Errors on the two real references |
|---|---:|---:|---|
| Moku v4 automatic pipeline | 14 / 20 | 1 / 2 | 4 missed stones, 3 extra stones, 0 wrong colours |
| image2sgf v0.07 automatic pipeline | 20 / 20 | 1 / 2 | 6 missed stones, 12 extra stones, 0 wrong colours |

Both native pipelines reconstructed `PXL_20240407_104618235` exactly against the visually checked 361-intersection reference. Moku made seven errors on the other checked photo; image2sgf made eighteen. The alternative is promising on generated boards but is not demonstrated to be better on real photos.

Moku's synthetic failures included badly located corners that still produced a board, including almost empty outputs for dense positions. No explicit detection errors were raised, so counting only successful return values would hide these failures. Its synthetic totals were 865 missed stones, 15 extra stones and 32 wrong-colour stones across 7,220 intersections. The alternative had no synthetic errors.

The first image2sgf adapter mapped bounding-box starts to intersection centres, causing a half-cell offset. Those results were discarded. The reported run corrects that geometry and implements the upstream low-confidence rectification refinement. Labels and corners were never supplied to inference.

Moku returned identical positions across the native Mac, Lambda, CPU and GPU tests. More powerful cloud hardware changes speed, not recognition quality for that pipeline. Two additional real photos had visibly incorrect automatic geometry; one produced an empty board. They lack reliable labels, so no exact error counts are claimed for them.

A separate phone-size desktop browser diagnostic using the production preprocessing pipeline found one false stone on the clear reference photo with reference corners, and two errors with small outward corner perturbations. This did **not** reproduce the many errors reported on the user's physical phone. It does not establish that manual calibration caused the reported problem, and emulator/desktop timings do not establish real phone performance.

## Recommendation and next work

The user requires complete feedback within **two minutes**, ideally **under one minute**, while both players wait. Measure that from initiating the photo request through upload, recognition and the first useful position-analysis result. A four-minute fresh GPU bootstrap is unsuitable for this interaction. The complete phone-to-result path has not yet been benchmarked, so the recognition timings alone do not establish that this target is met.

Use a private Lambda prototype at approximately 1,769 MB for further testing: the measured cold result was 7.16 seconds and warm results about 2.5 seconds, with little additional warm cost compared with 1,024 MB. The next latency test should combine phone upload, Lambda recognition and browser mini-analysis. The existing 3,008 MB account limit is sufficient for this baseline. AWS documents a general maximum of 10,240 MB and reduced memory/concurrency quotas for some new accounts; the account-specific increase request is a separate support workflow. See [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

Before exposing cloud recognition, improve automatic corner failure detection and test more independently labelled real phone photos, including dense and poorly lit boards. Return a detected board for stone corrections; do not require users to mark four corners. The tested alternative should remain an experiment until licensing and real-photo performance are resolved. It was evaluated on GPU, not benchmarked on Lambda, so the Lambda prices above must not be attributed to that larger model.

A public photo endpoint needs its own server-enforced request/spending limit before activation. The existing analysis shutdown does not by itself cap a new recognition endpoint. Keep local mini-analysis separate: no cloud KataGo compute is needed for the tested recognition pipeline.

## Cleanup and reproducibility

Aggregate measurements and cleanup evidence are in `photo-recognition-benchmark-20261007.json`. Reproducible fixture generation, workers and scoring are in `scripts/photo-benchmark/`; private inputs and raw board maps are excluded. All three temporary EC2 instances are confirmed terminated and the benchmark stack reached `DELETE_COMPLETE`, removing its Lambda, IAM role/profile, security group and log group. The private S3 test prefix is confirmed empty, including all 45 previous object versions and delete markers. Production resources are not part of this cleanup.

The additional development-cost allowance is conservatively **$0.50**, including the failed GPU stop/replacement and small Lambda/storage/log charges. This is an estimate, not a final AWS invoice. The development cost ledger records it separately from prior work.
