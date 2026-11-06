import { createHash } from 'node:crypto';
import sharp from 'sharp';

export interface CandidateImageAnalysis {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
  pixelHash: string;
  visualHash: string;
  flags: string[];
}

/** Normalize decoded, oriented pixels without enlarging or cropping the original. */
export async function analyzeCandidateImage(bytes: Buffer): Promise<CandidateImageAnalysis> {
  const { data: pixels, info } = await sharp(bytes, { failOn: 'error' })
    .autoOrient()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const normalized = sharp(pixels, { raw: { width, height, channels: 4 } });
  const normalizedBytes = await normalized.clone().png().toBuffer();

  const dimensions = Buffer.alloc(8);
  dimensions.writeUInt32BE(width, 0);
  dimensions.writeUInt32BE(height, 4);
  const pixelHash = createHash('sha256').update(dimensions).update(pixels).digest('hex');

  // A 16x16 horizontal difference hash groups likely resize variants for review;
  // perceptual similarity alone is not evidence of identical pictures or scenes.
  const samples = await normalized
    .clone()
    .flatten({ background: '#ffffff' })
    .resize(17, 16, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  const hash = Buffer.alloc(32);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const bit = y * 16 + x;
      if (samples[y * 17 + x] > samples[y * 17 + x + 1]) {
        hash[Math.floor(bit / 8)] |= 1 << (7 - (bit % 8));
      }
    }
  }

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const flags: string[] = [];
  if (shortSide < 400 || longSide < 800) flags.push('small_image');
  if (longSide / shortSide > 3) flags.push('extreme_aspect');
  return {
    bytes: normalizedBytes,
    width,
    height,
    sha256: createHash('sha256').update(normalizedBytes).digest('hex'),
    pixelHash,
    visualHash: hash.toString('hex'),
    flags,
  };
}

/** Hamming distance for equal-length hexadecimal hashes, including nibble hashes. */
export function visualHashDistance(a: string, b: string): number {
  if (!a.length || a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) {
    throw new Error('visual_hash_invalid');
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let different = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (different) {
      distance++;
      different &= different - 1;
    }
  }
  return distance;
}
