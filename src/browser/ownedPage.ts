import type { BrowserContext, Page } from 'playwright';
export async function pageTargetId(page: Page): Promise<string> {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send('Target.getTargetInfo');
    return result.targetInfo.targetId;
  } finally {
    await session.detach();
  }
}
export async function findOwnedPage(context: BrowserContext, targetId: string): Promise<Page> {
  if (!/^[a-zA-Z0-9_-]+$/.test(targetId)) throw Error('invalid_owned_target');
  for (const page of context.pages())
    if (!page.isClosed() && (await pageTargetId(page)) === targetId) return page;
  throw Error('needs_user:owned_editor_missing');
}
