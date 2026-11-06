import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page, Locator } from 'playwright';
import sharp from 'sharp';
import { sha256 } from '../state/files.js';
import { inspectRegion, assertRegionReady } from './readiness.js';
export async function captureRegion({
  page,
  locator,
  outputPath,
  requiredLabels,
  frameOwner,
}: {
  page: Page;
  locator: Locator;
  outputPath: string;
  requiredLabels: string[];
  frameOwner?: Locator;
}): Promise<{ width: number; height: number; sha256: string }> {
  if (!isAbsolute(outputPath)) throw Error('absolute_capture_path_required');
  await page.bringToFront();
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.scrollIntoViewIfNeeded();
  const deadline = Date.now() + 10000;
  let previous = '';
  do {
    try {
      if (frameOwner) {
        const area = await locator.boundingBox();
        if (!area) throw Error('region_not_visible');
        assertRegionReady(await inspectRegion(frameOwner, area), []);
      }
      const state = await inspectRegion(locator);
      assertRegionReady(state, requiredLabels);
      const signature = JSON.stringify({
        width: state.width,
        height: state.height,
        text: state.text,
      });
      if (signature === previous) {
        const clip = await locator.boundingBox();
        if (!clip) throw Error('region_not_visible');
        assertRegionReady(await inspectRegion(locator), requiredLabels);
        if (frameOwner) assertRegionReady(await inspectRegion(frameOwner, clip), []);
        const bytes = await page.screenshot({ type: 'png', clip, timeout: 10000 }),
          meta = await sharp(bytes).metadata();
        if (meta.format !== 'png' || !meta.width || !meta.height)
          throw Error('invalid_capture_png');
        await mkdir(dirname(outputPath), { recursive: true });
        const temp = outputPath + '.' + randomUUID() + '.tmp';
        await writeFile(temp, bytes, { flag: 'wx' });
        await rename(temp, outputPath);
        return { width: meta.width, height: meta.height, sha256: sha256(bytes) };
      }
      previous = signature;
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (!/images_unfinished|region_not_visible/.test(code)) throw error;
    }
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  throw Error('capture_readiness_timeout');
}
