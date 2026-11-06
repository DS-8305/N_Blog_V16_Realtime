import type { Page } from 'playwright';
export async function probePageSession(
  page: Page,
): Promise<'authenticated' | 'login_required' | 'security_check'> {
  const deadline = Date.now() + 15000;
  do {
    if (/nid\.naver\.com|nidlogin|nidLogin/.test(page.url())) return 'login_required';
    for (const frame of page.frames()) {
      if (
        await frame
          .locator('input#captcha,input[name="captcha"],input#captchaimg')
          .first()
          .isVisible()
          .catch(() => false)
      )
        return 'security_check';
    }
    for (const frame of page.frames()) {
      if (
        await frame
          .locator('.se-components-wrap')
          .first()
          .isVisible()
          .catch(() => false)
      )
        return 'authenticated';
    }
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  return 'login_required';
}
export async function assertBlogTarget(page: Page, blogId: string): Promise<void> {
  for (const frame of page.frames()) {
    if (
      !(await frame
        .locator('.se-components-wrap')
        .first()
        .isVisible()
        .catch(() => false))
    )
      continue;
    const u = new URL(frame.url());
    if (u.hostname !== 'blog.naver.com') continue;
    const routed = u.searchParams.get('blogId') ?? u.searchParams.get('blogid');
    if (
      (/PostWriteForm\.naver/i.test(u.pathname) && routed === blogId) ||
      u.pathname === `/${blogId}/postwrite`
    )
      return;
  }
  throw Error('needs_user:blog_target_unconfirmed');
}
