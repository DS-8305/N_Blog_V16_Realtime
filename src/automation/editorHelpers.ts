import type { Page, Locator, Frame } from 'playwright';
import { selectors, NAVER_BLOG_WRITE_URL } from './selectors.js';
import { probePageSession } from './sessionProbe.js';
export async function firstVisible(
  page: Page,
  choices: readonly string[],
  timeout = 10000,
  last = false,
): Promise<Locator> {
  const until = Date.now() + timeout;
  do {
    if (page.isClosed()) throw new Error('owned_tab_closed');
    for (const frame of page.frames())
      for (const selector of choices) {
        const found = frame.locator(selector);
        const count = await found.count();
        for (let n = 0; n < count; n++) {
          const target = found.nth(last ? count - 1 - n : n);
          if (await target.isVisible()) return target;
        }
      }
    await page.waitForTimeout(100);
  } while (Date.now() < until);
  throw new Error('unsupported_editor_control:' + choices[0]);
}
export async function getEditorFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames())
    if (await frame.locator('.se-components-wrap').first().isVisible()) return frame;
  throw new Error('unsupported_editor_frame');
}
export async function assertNoExistingDraft(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const popup = frame
      .locator(selectors.existingDraftDialog)
      .filter({ hasText: /작성\s*중인\s*글|이어서\s*작성|임시저장.*불러/ });
    for (let i = 0; i < (await popup.count()); i++) {
      if (await popup.nth(i).isVisible()) {
        const cancel = popup.nth(i).locator('button').filter({ hasText: /취소/ });
        if (await cancel.isVisible()) {
          await cancel.click();
          await page.waitForTimeout(500);
          return;
        }
        throw new Error('needs_user:existing_draft');
      }
    }
  }
}
export async function prepareBlankEditor(page: Page): Promise<void> {
  if ((await probePageSession(page)) !== 'authenticated') throw new Error('needs_user:login');
  await assertNoExistingDraft(page);
  const title = await firstVisible(page, selectors.title),
    frame = await getEditorFrame(page);
  const titleText = (await title.innerText()).trim(),
    texts = await frame
      .locator('.se-module-text:not(.se-title-text) .se-text-paragraph .__se-node')
      .allTextContents();
  if (
    !['', '제목'].includes(titleText) ||
    texts.some((text) => text.trim()) ||
    (await frame.locator(selectors.images).count())
  )
    throw new Error('needs_user:editor_not_blank');
}
export async function focusNormalBody(
  page: Page,
  mode: 'first' | 'last' | 'after_quote',
): Promise<void> {
  await assertNoExistingDraft(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    const frame = await getEditorFrame(page),
      helpClose = frame.locator('.se-help-panel.se-is-on button.se-help-panel-close-button');
    const helpCount = await helpClose.count();
    if (helpCount > 1) throw Error('editor_help_close_not_unique');
    if (helpCount === 1 && (await helpClose.first().isVisible()))
      await helpClose.first().click({ timeout: 5000 });
    const sidebarClose = frame.locator('.se-sidebar-interaction button.se-sidebar-close-button'),
      sidebarCount = await sidebarClose.count();
    if (sidebarCount > 1) throw Error('editor_sidebar_close_not_unique');
    if (sidebarCount === 1 && (await sidebarClose.first().isVisible()))
      await sidebarClose.first().click({ timeout: 5000 });
    const foldButton = frame.locator('button.se-flayer-unified-fold-button');
    if ((await foldButton.count()) > 0 && (await foldButton.first().isVisible()))
      await foldButton.first().click({ timeout: 3000 });
    const bodies = frame.locator('.se-component.se-text .se-module-text p.se-text-paragraph');
    const count = await bodies.count();
    for (let n = 0; n < count; n++) {
      const body = bodies.nth(mode === 'first' ? n : count - 1 - n);
      if (!(await body.isVisible())) continue;
      const follows = await body.evaluate((element) => {
        const doc = element.ownerDocument;
        const anchors = [
          ...doc.querySelectorAll(
            '.se-components-wrap .se-quotation, .se-components-wrap .se-module-image',
          ),
        ];
        const last = anchors.at(-1);
        return (
          !last || Boolean(last.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      });
      if (mode !== 'first' && !follows) continue;
      const box = await body.boundingBox();
      if (!box) continue;
      await body.click({
        force: true,
        position: {
          x: Math.max(5, Math.min(25, box.width - 5)),
          y: Math.max(5, Math.min(box.height - 5, box.height / 2)),
        },
      });
      await page.waitForTimeout(100);
      const characters = [...((await body.textContent()) ?? '')].length;
      for (let i = 0; i <= characters; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('End');
      await page.waitForTimeout(100);
      if ((await body.textContent())?.trim()) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(
          /https?:\/\/\S+$/.test((await body.textContent()) ?? '') ? 2500 : 200,
        );
      }
      return;
    }
    const add = frame.getByRole('button', { name: '본문 추가', exact: true });
    if ((await add.count()) !== 1) throw Error('normal_body_cursor_unconfirmed');
    await add.click();
    await page.waitForTimeout(100);
  }
  throw new Error('normal_body_cursor_unconfirmed');
}
export async function setBold(page: Page, enabled: boolean): Promise<void> {
  const button = await firstVisible(page, selectors.bold, 3000);
  const active = async () =>
    (await button.getAttribute('aria-pressed')) === 'true' ||
    ((await button.getAttribute('class')) ?? '').includes('se-is-selected');
  if ((await active()) === enabled) return;
  await button.click();
  const until = Date.now() + 3000;
  while ((await active()) !== enabled) {
    if (Date.now() >= until) throw new Error('bold_state_unconfirmed');
    await page.waitForTimeout(50);
  }
}
export async function setCenterAlignment(page: Page): Promise<void> {
  const button = await firstVisible(page, selectors.alignmentDropdown, 3000);
  const centered = async () =>
    ((await button.getAttribute('class')) ?? '').includes('se-align-center-toolbar-button');
  if (await centered()) return;
  await button.click();
  await (await firstVisible(page, selectors.alignmentCenterOption, 3000)).click();
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    if (await centered()) return;
    await page.waitForTimeout(50);
  }
  throw Error('center_alignment_unconfirmed');
}
