"""Private alternative stone-classifier evaluation with automatic Moku grid fitting.

Inference reads photos and model weights only; reference labels are scored separately.
The two patch classifiers share automatic geometry so their stone errors can be
compared without conflating different corner detectors. Not a production worker.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
import torch
from torchvision import models
from ultralytics import YOLO
from ultralytics.data.augment import classify_transforms

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend/position'))
import moku
from grid import supplement_stones

YOLO_SHA256 = 'be6f9ffb2de55f03bb8bf62ea2bd6807184729a0445be1293703a69c3f7a5962'


def rectify(image, quad):
    target = np.array([(64, 64), (735, 64), (735, 735), (64, 735)])
    inverse = np.linalg.inv(moku.homography(quad, target))
    inverse /= inverse[2, 2]
    warped = image.transform((800, 800), Image.Transform.PERSPECTIVE,
                             inverse.ravel()[:8], Image.Resampling.BILINEAR)
    return warped, target


def patches(image):
    step = 671 / 18
    return [image.crop((round(64 + col * step - step / 2),
                        round(64 + row * step - step / 2),
                        round(64 + col * step + step / 2),
                        round(64 + row * step + step / 2)))
            for row in range(19) for col in range(19)]


def result(sample_id, board, elapsed, confidence=None):
    row = {'id': sample_id, 'board': board,
           'counts': {c: board.count(c) for c in '.BW'},
           'stonePassMs': round(elapsed * 1000)}
    if confidence is not None:
        row['minimumConfidence'] = float(confidence.min())
        row['below90Percent'] = int((confidence < .9).sum())
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--yolo-weight', required=True)
    parser.add_argument('--efficientnet-weight', required=True)
    args = parser.parse_args()
    if hashlib.sha256(Path(args.yolo_weight).read_bytes()).hexdigest() != YOLO_SHA256:
        raise ValueError('Unexpected YOLO stone-classifier checkpoint')
    torch.set_num_threads(4)
    started = time.perf_counter()
    corner_model, _ = moku.session()
    yolo = YOLO(args.yolo_weight).model.eval()
    transform = classify_transforms(size=64)
    efficient = models.efficientnet_b3(weights=None, num_classes=6).eval()
    efficient.load_state_dict(torch.load(args.efficientnet_weight,
                                        map_location='cpu', weights_only=True))
    rows = {name: [] for name in ['moku-grid-fit', 'yolo-patches', 'efficientnet-patches']}
    output = {'initializationMs': round((time.perf_counter() - started) * 1000),
              'geometry': 'Automatic Moku corners with grid fit; no reference coordinates',
              'models': rows}
    for sample in json.loads(Path(args.samples).read_text()):
        start = time.perf_counter()
        try:
            image = ImageOps.exif_transpose(Image.open(sample['file'])).convert('RGB')
            raw = moku.predict(corner_model, image)
            quad = moku.corners(raw, *image.size)
            warped, target = rectify(image, quad)
            geometry_ms = round((time.perf_counter() - start) * 1000)
            t = time.perf_counter()
            detected = moku.predict(corner_model, warped)
            board = supplement_stones(warped, moku.classify(detected, target, 800, 800), detected)
            rows['moku-grid-fit'].append(result(sample['id'], board, time.perf_counter() - t))
            crops = patches(warped)
            t = time.perf_counter()
            batch = torch.stack([transform(crop) for crop in crops])
            with torch.inference_mode():
                predictions = [yolo(part)[0] for part in batch.split(64)]
            predictions = torch.cat(predictions)
            indices = predictions.argmax(1).tolist()
            names = yolo.names
            board = ''.join({'black': 'B', 'white': 'W', 'empty': '.'}[names[i]] for i in indices)
            rows['yolo-patches'].append(result(sample['id'], board, time.perf_counter() - t,
                                              predictions.max(1).values))
            t = time.perf_counter()
            batch = torch.stack([torch.from_numpy(np.asarray(crop.resize((45, 45)), dtype=np.float32).copy())
                                 .permute(2, 0, 1) / 255 for crop in crops])
            with torch.inference_mode():
                scores = torch.cat([efficient(part).softmax(1) for part in batch.split(32)])
            indices = scores.argmax(1).tolist()
            board = ''.join('.BW'[i >> 1] for i in indices)
            rows['efficientnet-patches'].append(result(sample['id'], board, time.perf_counter() - t,
                                                      scores.max(1).values))
            for model in rows:
                rows[model][-1]['geometryMs'] = geometry_ms
            print(sample['id'], {name: rows[name][-1]['counts'] for name in rows}, flush=True)
        except Exception as error:
            for name in rows:
                if not rows[name] or rows[name][-1]['id'] != sample['id']:
                    rows[name].append({'id': sample['id'], 'error': str(error)})
            print(sample['id'], str(error), flush=True)
        Path(args.output).write_text(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
