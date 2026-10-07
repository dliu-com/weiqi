# Bounded position services

Recognition uses automatic Moku v4 corners plus a rectified stone pass, ONNX Runtime on CPU, and the pinned model in `photo-analysis/SOURCES.json`. It runs on Lambda Python 3.12/x86_64; no image is written to disk or S3. The model is bundled at build time. Photos are compressed in the browser before upload.

Cloud AI uses the official KataGo 1.16.5 Eigen AVX2 binary and the same pinned small model as the browser. It searches one position up to the configured visits and ten seconds, with a shorter subprocess/Lambda deadline. It includes available SGF history. A photo has no history, so Japanese/Korean earlier capture counts and ko history are unavailable.

From the project root, run `make prepare-position-runtime` with Python 3.12/pip and the AWS CLI. It downloads pinned upstream models/binary, builds Linux wheel packages, uploads executable ZIPs to the existing private library bucket, and writes the code keys in `cloud/position-release.json`. Then `make deploy-infra` and `make publish`. Models, photos and generated packages are ignored by Git. The recognition code/model are AGPL-3.0-only; the native and browser KataGo engine/model are MIT. Corresponding feature sources and license texts are served at `/photo-assets/photo-source.tar.gz`.

Photo recognition uses automatic lattice fitting to reject interior corner peaks, plus a conservative pixel check for nearby low-score stone detections. Geometry scores do not establish stone accuracy. Photos remain experimental; the client shows the original photo for review and does not start AI until the user clicks Analyse position.
