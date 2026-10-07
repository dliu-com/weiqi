# Photo recognition benchmark

These scripts evaluate detection, not KataGo game analysis. They do not change the live `/analysis` page or upload anything by themselves.

Generate labelled synthetic fixtures from a saved SGF:

```sh
node scripts/photo-benchmark/generate-fixtures.mjs /path/to/game.sgf /tmp/photo-fixtures /path/to/python
```

The renderer uses Pillow and NumPy. Four legal SGF positions include captures; five deterministic conditions cover perspective, a lighting gradient, blur, JPEG compression and lower resolution. `references.json` holds exact position strings and grid geometry. **Never pass references or manually marked corners to inference.** `samples.json` contains image identifiers only. Rendered-board accuracy does not establish real-photo accuracy.

Moku's worker uses ONNX Runtime, Pillow, NumPy and boto3. It detects corners automatically, rectifies the board, then performs a stone pass. It validates the pinned Moku v4 model checksum and checks that CUDA really activated when GPU mode is requested. Set `MODEL_PATH`, `THREADS` and optionally `GPU=1`:

```sh
python scripts/photo-benchmark/moku_worker.py --samples /tmp/photo-fixtures/samples.json --image-dir /tmp/photo-fixtures --output /tmp/moku-results.json
python scripts/photo-benchmark/score.py /tmp/photo-fixtures/references.json /tmp/moku-results.json /tmp/scores.json
```

The alternative worker evaluates the public `noword/image2sgf` v0.07 FCOS and EfficientNet checkpoints with PyTorch, torchvision and OpenCV. It uses `torch.load(weights_only=True)` and automatic corner detection. Its source repository has no explicit licence file; it is a private experiment, not part of the product. Model licensing must be resolved before integration.

`patch_models.py` compares the earlier production Moku grid-fit stone pass (`grid-fit-20261007`, not the current tiled pipeline) with two intersection classifiers: `rociiu/yolo-go-stone-classifier` (YOLOv8n-cls, 64-pixel input) and image2sgf's EfficientNet-B3. All three share automatically detected corners and the same rectified image, so this comparison isolates stone classification. The independent FCOS/image2sgf worker above remains the complete alternative pipeline. The patch worker validates the downloaded YOLO checkpoint hash and receives only image identifiers and paths; references are supplied only to the separate scorer. Model files and Python inference libraries belong outside this repository.

```sh
MODEL_PATH=/private/path/moku.onnx python scripts/photo-benchmark/patch_models.py \
  --samples /private/path/samples.json --yolo-weight /private/path/best.pt \
  --efficientnet-weight /private/path/stone.pth --output /private/path/patch-results.json
```

Each sample's `file` is an image path. The output groups rows under `models`; write one group as `{"results": [...]}` before using `score.py`. The original-image comparison deliberately excludes browser JPEG resizing; its local CPU timings exclude upload, cloud startup and app rendering. Provisional real labels, generated labels, geometry failures and exact-board counts must remain separate when reporting results.

The 7 October alternative-model results are in `cloud/alternative-photo-models-20261007.json`. YOLO and the independent FCOS/EfficientNet pipeline reconstructed all 20 generated boards, but made 11 and 18 errors on the angled provisional real reference, versus 2 with Moku on the same original image. All matched the clear provisional reference. EfficientNet with the shared Moku grid made 23 angled-photo errors. Four real photos remain unlabelled; these tests do not establish their accuracy or general real-world performance. No alternative was deployed and no AWS compute was started for this comparison.

## Real photos with reference positions

`real_photos.py` runs the production handler (`backend/position/recognize.py`) on real photos. It encodes each upload exactly as the page does, and it can apply fixed lighting, colour, blur, rotation and compression conditions first. It reads only image paths. References are passed only to `score.py`. Result ids are `<id>@<condition>`, so one reference scores every condition. The scorer also reports how many errors fall on the review points that the page outlines.

```sh
MODEL_PATH=/private/path/moku.onnx THREADS=1 python scripts/photo-benchmark/real_photos.py \
  --samples /private/path/samples.json --output /private/path/results.json
python scripts/photo-benchmark/score.py /private/path/references.json /private/path/results.json /private/path/scores.json
```

`samples.json` is `{"samples": [{"id": "photo1", "file": "photo1.jpg"}]}`, with file paths relative to that JSON file. `references.json` holds `{"id", "board", "referenceKind"}` rows. `board` is 361 characters of `.`, `B`, `W` or `?`, in rows from the top of the upright photo. Rotate or mirror a reference to match the photo once, before scoring, and record that step.

The 7 October results are in `cloud/photo-recognition-real-20261007.json`. The references are the user's four photos, read correctly by a separate paid tool. On unchanged uploads, the deployed pipeline went from 1/4 exact boards (10 errors) to 4/4. Across all 48 conditions, it went from 12 exact boards to 43. The thresholds were developed on these four photos, so rescore on new, held-out photos before trusting a change. Keep the photos, references and raw results private.

## Manual references

For real photos, a separate reference may be created by visual inspection. Use `?` for any uncertain intersection; the scorer excludes it. Report the reference's provenance and whether it was independently verified. Label a photo before comparing model predictions, and retain uncertain labels rather than guessing. Do not describe assistant labels as independently established ground truth.

Score missed stones, extra stones, wrong colours and exact boards. Report detection failures separately: intersection accuracy on successful detections alone can hide failures. Do not estimate general real-world accuracy from a handful of photos.

Keep private photos, model weights, labels and raw results outside the repository. Keep cloud experiments private, tag all resources `Project=Weiqi`, bound instance run time, measure startup separately from warm inference, and delete temporary compute and private cloud test copies afterwards. Include VM idle, EBS and public IPv4 costs in comparisons; a per-inference compute estimate alone understates a warm server's bill.
