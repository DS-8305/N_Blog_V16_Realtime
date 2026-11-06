import type { Browser, BrowserContext } from 'playwright';
import type { Config } from '../domain/types.js';
import { acquireSlots } from '../images/acquire.js';
import { safeFile } from '../state/files.js';
import { captureRegion } from './captureRegion.js';
import { connectBrowser } from '../browser/session.js';
import { assertAllowedImageOrigin, assertAllowedImageSource } from '../images/sourcePolicy.js';
const redirectFailures = new WeakMap<BrowserContext, Error>();
export async function createCaptureContext(
  browser: Browser,
  sourceUrl: string,
): Promise<BrowserContext> {
  assertAllowedImageSource(sourceUrl);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    // Static public captures use only HTTP(S) page and image sources.
    await context.routeWebSocket('**/*', (socket) =>
      socket.close({
        code: 1008,
        reason: 'capture_http_sources_only',
      }),
    );
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        const check = (url: string) =>
          request.isNavigationRequest()
            ? assertAllowedImageSource(url)
            : assertAllowedImageSource(sourceUrl, url);
        check(request.url());
        // Never let the HTTP client follow an unchecked redirect automatically.
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() >= 300 && response.status() < 400 && response.headers()['location']) {
          // Chromium can skip route interception on later navigation hops.
          // Require the verified canonical URL instead of following any redirect.
          const error = Error('capture_redirect_requires_canonical_url');
          redirectFailures.set(context, error);
          throw error;
        }
        await route.fulfill({ response });
      } catch {
        await route.abort('blockedbyclient');
      }
    });
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}
export async function captureImages(job: string, config: Config, slot?: string): Promise<void> {
  let session: Awaited<ReturnType<typeof connectBrowser>> | undefined;
  try {
    await acquireSlots(
      job,
      'capture',
      async ({ sectionId, plan }) => {
        if (plan.mode !== 'capture') throw Error('wrong_image_mode');
        assertAllowedImageSource(plan.url);
        assertAllowedImageOrigin(plan.originKind ?? 'unknown', plan.originUrl ?? plan.url);
        session ??= await connectBrowser(config);
        const context = await createCaptureContext(session.browser, plan.url);
        try {
          const page = await context.newPage();
          await page.setViewportSize({ width: 1440, height: 2400 });
          await page.goto(plan.url, { waitUntil: 'domcontentloaded' });
          if (redirectFailures.has(context)) throw redirectFailures.get(context);
          assertAllowedImageSource(page.url());
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
          if (redirectFailures.has(context)) throw redirectFailures.get(context);
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
        } catch (error) {
          throw redirectFailures.get(context) ?? error;
        } finally {
          await context.close();
        }
      },
      slot,
    );
  } finally {
    await session?.release();
  }
}
