import type { GrayImage } from './types';

// ============================================================================
// Gaussian blur (separable)
// ============================================================================

function gaussianKernel1D(sigma: number): Float32Array {
  const half = Math.ceil(sigma * 3);
  const size = 2 * half + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - half;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

export function gaussianBlur(gray: GrayImage, sigma: number): GrayImage {
  const { data, width, height } = gray;
  const kernel = gaussianKernel1D(sigma);
  const half = (kernel.length - 1) / 2;
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = 0; k < kernel.length; k++) {
        const sx = Math.max(0, Math.min(width - 1, x + k - half));
        v += data[y * width + sx] * kernel[k];
      }
      tmp[y * width + x] = v;
    }
  }
  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = 0; k < kernel.length; k++) {
        const sy = Math.max(0, Math.min(height - 1, y + k - half));
        v += tmp[sy * width + x] * kernel[k];
      }
      out[y * width + x] = v;
    }
  }
  return { data: out, width, height };
}

// ============================================================================
// Sobel gradient
// ============================================================================

export function sobelGradient(gray: GrayImage): {
  magnitude: Float32Array;
  direction: Float32Array;
} {
  const { data, width, height } = gray;
  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -data[(y - 1) * width + (x - 1)] +
        data[(y - 1) * width + (x + 1)] +
        -2 * data[y * width + (x - 1)] +
        2 * data[y * width + (x + 1)] +
        -data[(y + 1) * width + (x - 1)] +
        data[(y + 1) * width + (x + 1)];
      const gy =
        -data[(y - 1) * width + (x - 1)] +
        -2 * data[(y - 1) * width + x] +
        -data[(y - 1) * width + (x + 1)] +
        data[(y + 1) * width + (x - 1)] +
        2 * data[(y + 1) * width + x] +
        data[(y + 1) * width + (x + 1)];
      const idx = y * width + x;
      magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      direction[idx] = Math.atan2(gy, gx);
    }
  }
  return { magnitude, direction };
}

// ============================================================================
// Non-maximum suppression
// ============================================================================

function nonMaxSuppression(
  magnitude: Float32Array,
  direction: Float32Array,
  width: number,
  height: number
): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx];
      let theta = (direction[idx] * 180) / Math.PI;
      if (theta < 0) theta += 180;

      let n1: number, n2: number;
      if (theta < 22.5 || theta >= 157.5) {
        n1 = magnitude[idx - 1];
        n2 = magnitude[idx + 1];
      } else if (theta < 67.5) {
        n1 = magnitude[(y + 1) * width + (x - 1)];
        n2 = magnitude[(y - 1) * width + (x + 1)];
      } else if (theta < 112.5) {
        n1 = magnitude[(y - 1) * width + x];
        n2 = magnitude[(y + 1) * width + x];
      } else {
        n1 = magnitude[(y - 1) * width + (x - 1)];
        n2 = magnitude[(y + 1) * width + (x + 1)];
      }
      out[idx] = mag >= n1 && mag >= n2 ? mag : 0;
    }
  }
  return out;
}

// ============================================================================
// Hysteresis thresholding
// ============================================================================

function hysteresisThreshold(
  nms: Float32Array,
  width: number,
  height: number,
  high: number,
  low: number
): Uint8Array {
  const result = new Uint8Array(width * height);
  const STRONG = 2;
  const WEAK = 1;

  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= high) result[i] = STRONG;
    else if (nms[i] >= low) result[i] = WEAK;
  }

  // BFS from strong edges
  const queue: number[] = [];
  for (let i = 0; i < result.length; i++) {
    if (result[i] === STRONG) queue.push(i);
  }
  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (result[ni] === WEAK) {
          result[ni] = STRONG;
          queue.push(ni);
        }
      }
    }
  }

  const binary = new Uint8Array(width * height);
  for (let i = 0; i < result.length; i++) binary[i] = result[i] === STRONG ? 255 : 0;
  return binary;
}

// ============================================================================
// Auto-threshold estimation (Otsu's method on edge magnitudes)
// ============================================================================

function estimateThresholds(magnitude: Float32Array): { high: number; low: number } {
  // Find 70th and 40th percentile of non-zero magnitudes
  const nonZero: number[] = [];
  for (const v of magnitude) {
    if (v > 0) nonZero.push(v);
  }
  if (nonZero.length === 0) return { high: 100, low: 40 };
  nonZero.sort((a, b) => a - b);
  const high = nonZero[Math.floor(nonZero.length * 0.7)];
  const low = high * 0.4;
  return { high, low };
}

// ============================================================================
// Full Canny pipeline
// ============================================================================

export function canny(
  gray: GrayImage,
  sigma = 1.4,
  highThresh?: number,
  lowThresh?: number
): Uint8Array {
  const blurred = gaussianBlur(gray, sigma);
  const { magnitude, direction } = sobelGradient(blurred);
  const nms = nonMaxSuppression(magnitude, direction, gray.width, gray.height);

  let high = highThresh;
  let low = lowThresh;
  if (high === undefined || low === undefined) {
    const auto = estimateThresholds(magnitude);
    high = highThresh ?? auto.high;
    low = lowThresh ?? auto.low;
  }
  return hysteresisThreshold(nms, gray.width, gray.height, high, low);
}
