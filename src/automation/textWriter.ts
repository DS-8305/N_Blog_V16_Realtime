import type { Page } from 'playwright';
import type { EditorEvent } from '../domain/types.js';
import {
  firstVisible,
  focusNormalBody,
  setBold,
  setCenterAlignment,
  getEditorFrame,
} from './editorHelpers.js';
import { selectors } from './selectors.js';
import { typingSpeeds, type TypingSpeedName } from './typingSpeed.js';
export interface TextPort {
  setTitle(text: string): Promise<void>;
  focusBody(mode: 'first' | 'last' | 'after_quote'): Promise<void>;
  alignCenter(): Promise<void>;
  type(text: string): Promise<void>;
  enter(): Promise<void>;
  bold(enabled: boolean): Promise<void>;
  quote(text: string, bold?: boolean): Promise<void>;
}
export function pageTextPort(page: Page, speed: TypingSpeedName = 'normal'): TextPort {
  const profile = typingSpeeds[speed];
  let urlAtEnd = false;
  return {
    setTitle: async (text) => {
      const title = await firstVisible(page, selectors.title);
      await title.click();
      await title.press('Control+A');
      await title.press('Backspace');
      await title.pressSequentially(text, { delay: profile.keyDelayMs });
      if ((await title.innerText()).trim() !== text.trim()) throw Error('title_unconfirmed');
      await title.press('Enter');
    },
    focusBody: (mode) => focusNormalBody(page, mode),
    alignCenter: () => setCenterAlignment(page),
    type: async (text) => {
      urlAtEnd = /https?:\/\/\S+$/.test(text);
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      for (const [i, line] of lines.entries()) {
        await page.keyboard.insertText(line);
        // SmartEditor updates its model and caret after the browser input event.
        await page.waitForTimeout(profile.blockPauseMs);
        if (i < lines.length - 1) {
          await page.keyboard.press('Enter');
          await setCenterAlignment(page);
        }
      }
    },
    enter: async () => {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(urlAtEnd ? 2500 : profile.linePauseMs);
      urlAtEnd = false;
    },
    bold: (enabled) => setBold(page, enabled),
    quote: async (text, bold = false) => {
      await focusNormalBody(page, 'last');
      await (await firstVisible(page, selectors.quoteMenu, 3000)).click();
      await (await firstVisible(page, selectors.quoteOption, 3000)).click();
      await setCenterAlignment(page);
      if (bold) await setBold(page, true);
      try {
        await page.keyboard.insertText(text);
        await page.waitForTimeout(profile.blockPauseMs);
      } finally {
        if (bold) await setBold(page, false);
      }
      const frame = await getEditorFrame(page);
      if (!(await frame.locator(selectors.quoteBlock[0]).last().innerText()).includes(text))
        throw Error('quote_unconfirmed');
      await focusNormalBody(page, 'after_quote');
      await page.waitForTimeout(profile.blockPauseMs);
    },
  };
}
export class TextWriter {
  private preferFirstBodyAfterTitle = false;
  private preferBodyAfterQuote = false;
  constructor(private readonly port: TextPort) {}
  async prepareImage(): Promise<void> {
    await this.focus();
  }
  private async focus(): Promise<void> {
    await this.port.focusBody(
      this.preferBodyAfterQuote ? 'after_quote' : this.preferFirstBodyAfterTitle ? 'first' : 'last',
    );
    this.preferBodyAfterQuote = false;
    this.preferFirstBodyAfterTitle = false;
  }
  async apply(
    event: Exclude<EditorEvent, { type: 'insertImage' | 'setImageCaption' }>,
  ): Promise<void> {
    if (event.type === 'setTitle') {
      await this.port.setTitle(event.text);
      this.preferFirstBodyAfterTitle = true;
      return;
    }
    if (event.type === 'insertQuote') {
      await this.port.quote(event.text, event.bold);
      this.preferBodyAfterQuote = true;
      return;
    }
    await this.focus();
    await this.port.alignCenter();
    await this.port.bold(event.type === 'typeBold');
    try {
      await this.port.type(event.text);
    } finally {
      if (event.type === 'typeBold') await this.port.bold(false);
    }
    await this.port.enter();
  }
}
