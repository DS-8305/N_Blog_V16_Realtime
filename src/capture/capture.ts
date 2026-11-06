import { writeFile } from 'node:fs/promises';
import type { Config } from '../domain/types.js';
import { acquireSlots } from '../images/acquire.js';
import { safeFile } from '../state/files.js';
import { captureRegion } from './captureRegion.js';
import { connectBrowser } from '../browser/session.js';
export async function captureImages(job: string, config: Config, slot?: string): Promise<void> {
  let session: Awaited<ReturnType<typeof connectBrowser>> | undefined;
  try {
    await acquireSlots(
      job,
      'capture',
      async ({ sectionId, plan }) => {
        if (plan.mode !== 'capture') throw Error('wrong_image_mode');
        session ??= await connectBrowser(config);
        const page = await session.context.newPage();
        try {
          await page.setViewportSize({ width: 1440, height: 2400 });
          await page.goto(plan.url, { waitUntil: 'domcontentloaded' });
          if (new URL(page.url()).hostname !== new URL(plan.url).hostname)
            throw Error('capture_redirect_host');
          await page.addStyleTag({
            content:
              '::-webkit-scrollbar {display:none!important} html,body {scrollbar-width:none!important}',
          });
          const scope = plan.frameSelector ? page.frameLocator(plan.frameSelector) : page,
            region = scope.locator(plan.selector);
          if ((await region.count()) !== 1) throw Error('capture_region_not_unique');
          await region.waitFor({ state: 'visible' });
          const box = await region.boundingBox();
          if (box && box.height > 2200)
            await page.setViewportSize({
              width: 1440,
              height: Math.min(6000, Math.ceil(box.height + 250)),
            });
          const relativePath = `images/${plan.slotId}.png`,
            outputPath = await safeFile(job, relativePath),
            text = await region.innerText();
          const result = await captureRegion({
            page,
            locator: region,
            outputPath,
            requiredLabels: plan.requiredLabels,
            ...(plan.frameSelector ? { frameOwner: page.locator(plan.frameSelector) } : {}),
          });
          if ((await region.innerText()) !== text) throw Error('capture_content_changed');
          return {
            assetId: plan.slotId,
            slotId: plan.slotId,
            sectionId,
            kind: 'capture',
            relativePath,
            ...result,
            sourceUrl: page.url(),
            originalUrl: null,
            acquiredAt: new Date().toISOString(),
            caption: plan.caption ?? '',
            selector: plan.selector,
          };
        } finally {
          await page.close();
        }
      },
      slot,
    );
  } finally {
    await session?.release();
  }
}
