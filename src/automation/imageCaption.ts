import type { Page } from 'playwright';
import { getEditorFrame, setCenterAlignment } from './editorHelpers.js';
import { selectors } from './selectors.js';
export async function setImageCaption(page: Page, text: string): Promise<void> {
  const frame = await getEditorFrame(page),
    image = frame.locator(selectors.images).last(),
    component = image.locator('xpath=ancestor::div[contains(@class,"se-component")][1]');
  await image.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await image.click();
  await page.waitForTimeout(200);
  const caption = component.locator('.se-caption .se-text-paragraph');
  if ((await caption.count()) !== 1 || !(await caption.isVisible()))
    throw Error('needs_user:native_caption_unsupported');
  if ((await caption.locator('.__se-node').allTextContents()).join('').trim())
    throw Error('native_caption_not_blank');
  await caption.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await caption.click();
  await page.waitForTimeout(200);
  if (!((await caption.getAttribute('class')) ?? '').includes('se-text-paragraph-align-center'))
    await setCenterAlignment(page);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(200);
  if ((await caption.locator('.__se-node').allTextContents()).join('') !== text) {
    await caption.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await page.waitForTimeout(200);
    if ((await caption.locator('.__se-node').allTextContents()).join('') !== text)
      throw Error('native_caption_unconfirmed');
  }
}
