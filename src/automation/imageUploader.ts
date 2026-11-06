import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import type { CapturedAsset, EditorEvent } from '../domain/types.js';
import type { ImageReceipt } from '../domain/types.js';
import { sha256 } from '../state/files.js';
import { getEditorFrame, firstVisible } from './editorHelpers.js';
import { selectors } from './selectors.js';
export interface ImageObservation {
  key: string;
  src: string;
  loaded: boolean;
  width: number;
  height: number;
}
export interface ImagePort {
  read(): Promise<ImageObservation[]>;
  upload(path: string): Promise<void>;
  pause(): Promise<void>;
}
export function isEvidenceImage(src: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(src).protocol);
  } catch {
    return false;
  }
}
export function pageImagePort(page: Page): ImagePort {
  return {
    read: async () => {
      const frame = await getEditorFrame(page),
        elements = await frame.locator(selectors.images).all(),
        observations: ImageObservation[] = [];
      for (const element of elements) {
        await element.scrollIntoViewIfNeeded();
        await frame
          .evaluate(() => {
            window.dispatchEvent(new Event('scroll'));
            document.querySelector('.se-main-container')?.dispatchEvent(new Event('scroll'));
          })
          .catch(() => {});
        const until = Date.now() + 3000;
        let observation: ImageObservation;
        do {
          observation = await element.evaluate((element) => {
            const image = element.querySelector('img'),
              component = element.closest('.se-component');
            return {
              key:
                element.getAttribute('data-id') ||
                element.id ||
                component?.getAttribute('data-id') ||
                component?.id ||
                '',
              src: image?.currentSrc ?? image?.src ?? '',
              loaded: Boolean(image?.complete && image.naturalWidth && image.naturalHeight),
              width: image?.naturalWidth ?? 0,
              height: image?.naturalHeight ?? 0,
            };
          });
          observation.loaded = observation.loaded && isEvidenceImage(observation.src);
          if (observation.loaded) break;
          await page.waitForTimeout(100);
        } while (Date.now() < until);
        observations.push(observation);
      }
      return observations;
    },
    upload: async (path) => {
      for (const frame of page.frames())
        for (const selector of selectors.fileInput) {
          const input = frame.locator(selector);
          if ((await input.count()) === 1) {
            await input.setInputFiles(path);
            return;
          }
        }
      const toolbar = await firstVisible(page, selectors.imageToolbar, 5000);
      const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
      await toolbar.click();
      await (await chooser).setFiles(path);
    },
    pause: () => page.waitForTimeout(150),
  };
}
export async function insertImage(
  page: Page,
  event: Extract<EditorEvent, { type: 'insertImage' }>,
  asset: CapturedAsset,
  options: { port?: ImagePort; timeoutMs?: number } = {},
): Promise<ImageReceipt> {
  if (
    event.assetId !== asset.assetId ||
    sha256(await readFile(event.absolutePath)) !== asset.sha256
  )
    throw new Error('asset_hash_mismatch');
  const port = options.port ?? pageImagePort(page),
    before = await port.read();
  await port.upload(event.absolutePath);
  const deadline = Date.now() + (options.timeoutMs ?? 20000);
  do {
    const after = await port.read();
    if (after.length > before.length + 1) throw new Error('unexpected_image_count');
    if (after.length === before.length + 1) {
      if (
        before.some(
          (b, i) =>
            b.key !== after[i]?.key ||
            (isEvidenceImage(b.src) && isEvidenceImage(after[i]?.src) && b.src !== after[i]?.src),
        )
      )
        throw new Error('wrong_image_position');
      const image = after.at(-1)!;
      if (before.some((b) => b.key === image.key)) throw new Error('image_key_not_unique');
      if (image.loaded && isEvidenceImage(image.src)) {
        if (Math.abs(image.width / image.height - asset.width / asset.height) > 0.02)
          throw new Error('image_ratio_mismatch');
        return {
          assetId: asset.assetId,
          blockKey: image.key,
          index: before.length,
          confirmedAt: new Date().toISOString(),
        };
      }
    }
    await port.pause();
  } while (Date.now() < deadline);
  throw new Error('image_unconfirmed');
}
