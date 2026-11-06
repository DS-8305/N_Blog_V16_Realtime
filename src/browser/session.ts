import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { resolve, relative, isAbsolute } from 'node:path';
import { realpath, mkdir } from 'node:fs/promises';
import type { Config, JobRequest } from '../domain/types.js';
import { acquireBrowserLocks } from './runLock.js';
import { findOwnedPage, pageTargetId } from './ownedPage.js';
import { normalizeEndpoint } from '../config.js';
export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  targetId: string;
  release(): Promise<void>;
}
export async function verifyProfile(context: BrowserContext, profilePath: string) {
  const page = await context.newPage();
  try {
    await page.goto('chrome://version/');
    const actual = (await page.locator('#profile_path').innerText()).trim();
    const expected = await realpath(profilePath),
      found = await realpath(actual),
      r = relative(expected, found);
    if (isAbsolute(r) || r.startsWith('..')) throw Error('needs_user:chrome_profile_mismatch');
  } finally {
    await page.close();
  }
}
export async function connectBrowser(config: Config) {
  const endpoint = normalizeEndpoint(config.cdpEndpoint);
  await mkdir(config.profilePath, { recursive: true });
  const unlock = await acquireBrowserLocks(endpoint, config.profilePath);
  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
    const context = browser.contexts()[0];
    if (!context) throw Error('cdp_context_missing');
    await verifyProfile(context, config.profilePath);
    return {
      browser,
      context,
      release: async () => {
        try {
          await browser!.close();
        } finally {
          await unlock();
        }
      },
    };
  } catch (e) {
    await browser?.close().catch(() => {});
    await unlock();
    throw e;
  }
}
export async function openSession(
  config: Config,
  request: Pick<JobRequest, 'blogId'>,
  targetId?: string,
): Promise<Session> {
  const connected = await connectBrowser(config);
  try {
    const page = targetId
      ? await findOwnedPage(connected.context, targetId)
      : await connected.context.newPage();
    if (!targetId)
      await page.goto(
        `https://blog.naver.com/GoBlogWrite.naver?blogId=${encodeURIComponent(request.blogId)}`,
        { waitUntil: 'domcontentloaded' },
      );
    return { ...connected, page, targetId: await pageTargetId(page) };
  } catch (e) {
    await connected.release();
    throw e;
  }
}
