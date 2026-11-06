import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analyzeCandidateImage, visualHashDistance } from '../src/images/candidateQuality.js';

async function scene(width: number, height: number, kind: 'mountain' | 'stage' = 'mountain') {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const ny = y / height;
      let color: number[];
      if (kind === 'mountain') {
        const ridge = 0.7 - 0.42 * Math.sin(nx * Math.PI) - 0.1 * Math.sin(nx * 5 * Math.PI);
        color = ny > ridge ? [30 + nx * 60, 70 + ny * 80, 45] : [80 + nx * 100, 160, 230];
        if (Math.hypot(nx - 0.8, ny - 0.15) < 0.08) color = [250, 240, 170];
      } else {
        color = [25, 15, 35];
        if (nx % 0.3 < 0.1) color = [200 - ny * 80, 50, 80 + ny * 100];
        if (ny > 0.65) color = [40 + nx * 40, 40, 50];
        if (
          Math.hypot(nx - 0.43, ny - 0.45) < 0.1 ||
          (nx > 0.37 && nx < 0.49 && ny > 0.5 && ny < 0.85)
        )
          color = [220, 200, 180];
      }
      const offset = (y * width + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe('candidate image analysis', () => {
  it('preserves source resolution and aspect while returning a decodable PNG and its digest', async () => {
    const original = await scene(1200, 800);
    const input = await sharp(original).webp({ lossless: true }).toBuffer();
    const analyzed = await analyzeCandidateImage(input);
    expect(analyzed).toMatchObject({ width: 1200, height: 800, flags: [] });
    expect(await sharp(analyzed.bytes).metadata()).toMatchObject({
      format: 'png',
      width: 1200,
      height: 800,
    });
    expect(analyzed.sha256).toBe(createHash('sha256').update(analyzed.bytes).digest('hex'));
    expect(analyzed.pixelHash).toMatch(/^[a-f0-9]{64}$/);
    expect(analyzed.visualHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('recognizes exact decoded pixels despite different encodings and ignores metadata', async () => {
    const original = await scene(800, 500);
    const alternate = await sharp(original)
      .withMetadata({ density: 144 })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const [first, second] = await Promise.all([
      analyzeCandidateImage(original),
      analyzeCandidateImage(alternate),
    ]);
    expect(original.equals(alternate)).toBe(false);
    expect(first.pixelHash).toBe(second.pixelHash);
    expect(first.sha256).toBe(second.sha256);
    expect(first.visualHash).toBe(second.visualHash);
  });

  it('groups a resized photograph for review while distinguishing a different scene', async () => {
    const original = await scene(1200, 800);
    const resized = await sharp(original).resize(600, 400).jpeg({ quality: 85 }).toBuffer();
    const [first, smaller, different] = await Promise.all([
      analyzeCandidateImage(original),
      analyzeCandidateImage(resized),
      scene(1200, 800, 'stage').then(analyzeCandidateImage),
    ]);
    expect(smaller.pixelHash).not.toBe(first.pixelHash);
    expect(visualHashDistance(first.visualHash, smaller.visualHash)).toBeLessThanOrEqual(12);
    expect(visualHashDistance(first.visualHash, different.visualHash)).toBeGreaterThan(40);
  });

  it('keeps dimensionally different flat images distinct in the exact pixel hash', async () => {
    const makeFlat = (width: number, height: number) =>
      sharp({
        create: { width, height, channels: 3, background: '#aabbcc' },
      })
        .png()
        .toBuffer();
    const [wide, tall] = await Promise.all([
      makeFlat(800, 400).then(analyzeCandidateImage),
      makeFlat(400, 800).then(analyzeCandidateImage),
    ]);
    expect(wide.pixelHash).not.toBe(tall.pixelHash);
  });

  it('changes the exact pixel hash when one pixel changes at the same dimensions', async () => {
    const original = await scene(800, 500);
    const { data, info } = await sharp(original).raw().toBuffer({ resolveWithObject: true });
    data[0] ^= 1;
    const changed = await sharp(data, { raw: info }).png().toBuffer();
    const [first, second] = await Promise.all([
      analyzeCandidateImage(original),
      analyzeCandidateImage(changed),
    ]);
    expect(first.pixelHash).not.toBe(second.pixelHash);
    expect(first.sha256).not.toBe(second.sha256);
  });

  it('autorotates EXIF orientation and preserves the pictured corner locations', async () => {
    const original = await sharp({
      create: { width: 800, height: 500, channels: 3, background: '#0000ff' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 100, height: 100, channels: 3, background: '#ff0000' },
          })
            .png()
            .toBuffer(),
          top: 0,
          left: 0,
        },
      ])
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();
    const analyzed = await analyzeCandidateImage(original);
    expect(analyzed).toMatchObject({ width: 500, height: 800, flags: [] });
    const { data, info } = await sharp(analyzed.bytes).raw().toBuffer({ resolveWithObject: true });
    const corner = (x: number, y: number) => [
      ...data.subarray(
        (y * info.width + x) * info.channels,
        (y * info.width + x) * info.channels + 3,
      ),
    ];
    expect(corner(450, 50)).toEqual([255, 0, 0]);
    expect(corner(50, 50)).toEqual([0, 0, 255]);
    expect((await sharp(analyzed.bytes).metadata()).orientation).toBeUndefined();
  });

  it.each<[number, number, string[]]>([
    [320, 2721, ['small_image', 'extreme_aspect']],
    [399, 900, ['small_image']],
    [400, 799, ['small_image']],
    [400, 800, []],
    [1200, 400, []],
    [1201, 400, ['extreme_aspect']],
    [40, 30, ['small_image']],
  ])(
    'flags mechanical quality at %sx%s without enlarging the source',
    async (width, height, flags) => {
      const input = await sharp({
        create: { width, height, channels: 3, background: '#445566' },
      })
        .png()
        .toBuffer();
      const analyzed = await analyzeCandidateImage(input);
      expect(analyzed).toMatchObject({ width, height, flags });
      expect(await sharp(analyzed.bytes).metadata()).toMatchObject({ width, height });
    },
  );

  it('rejects invalid bytes and a truncated image rather than making a candidate', async () => {
    const valid = await scene(800, 500);
    await expect(
      analyzeCandidateImage(Buffer.from('<html>not a photograph</html>')),
    ).rejects.toThrow();
    await expect(
      analyzeCandidateImage(valid.subarray(0, Math.floor(valid.length / 2))),
    ).rejects.toThrow();
  });
});

describe('visual hash distance', () => {
  it.each([
    ['00', '00', 0],
    ['0f', 'f0', 8],
    ['a5', 'a4', 1],
    ['a', 'f', 2],
    ['AF', 'af', 0],
    ['00'.repeat(32), 'ff'.repeat(32), 256],
  ])('counts differing bits for %s and %s', (first, second, expected) => {
    expect(visualHashDistance(first, second)).toBe(expected);
  });

  it.each([
    ['', ''],
    ['00', '0000'],
    ['gg', '00'],
    [' 00', '000'],
  ])('rejects invalid or unequal hexadecimal hashes %s and %s', (first, second) => {
    expect(() => visualHashDistance(first, second)).toThrow();
  });
});
