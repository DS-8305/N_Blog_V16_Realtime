import type { Page, Locator } from 'playwright';
import type {
  Config,
  PreparedDraft,
  Snapshot,
  TextAlignment,
  SaveReceipt,
  ImageReceipt,
} from '../domain/types.js';
import type { EditorPort, InputProof } from './runner.js';
import { openSession } from '../browser/session.js';
import { assertBlogTarget, probePageSession } from './sessionProbe.js';
import { TextWriter, pageTextPort } from './textWriter.js';
import { pageImagePort, insertImage } from './imageUploader.js';
import { setImageCaption } from './imageCaption.js';
import {
  prepareBlankEditor,
  firstVisible,
  getEditorFrame,
  assertNoExistingDraft,
} from './editorHelpers.js';
import { selectors } from './selectors.js';
import { matchesSnapshot, normalizeText } from './readback.js';
export async function readEditorSnapshot(page: Page): Promise<Snapshot> {
  const title = await firstVisible(page, selectors.title),
    frame = await getEditorFrame(page);
  const texts = await frame
    .locator('.se-components-wrap .se-text-paragraph')
    .evaluateAll((elements) =>
      elements
        .filter((e) => !e.closest('.se-title-text,.se-section-documentTitle'))
        .map((e) =>
          [...e.querySelectorAll('.__se-node')].map((n) => (n as HTMLElement).innerText).join(''),
        ),
    );
  const titleText = (await title.innerText()).trim();
  const layout = await frame
    .locator('.se-components-wrap .se-text-paragraph, .se-components-wrap .se-module-image')
    .evaluateAll((elements) => {
      const alignment = (element: Element): TextAlignment => {
        const match = (element.getAttribute('class') ?? '').match(
          /se-text-paragraph-align-(left|center|right|justify)/,
        );
        return (match?.[1] as TextAlignment | undefined) ?? 'default';
      };
      const blocks: Snapshot['layout'] = [];
      for (const element of elements) {
        if (element.matches('.se-module-image')) {
          const component = element.closest('.se-component');
          const key =
            element.getAttribute('data-id') ||
            element.id ||
            component?.getAttribute('data-id') ||
            component?.id ||
            '';
          const captions = [...(component?.querySelectorAll('.se-caption .se-text-paragraph') ?? [])];
          const caption = captions
            .map((p) =>
              [...p.querySelectorAll('.__se-node')]
                .map((n) => (n as HTMLElement).innerText)
                .join(''),
            )
            .join('\n');
          blocks.push({
            kind: 'image',
            key,
            caption,
            captionAlignment: caption.trim() ? alignment(captions[0]) : null,
          });
        } else if (!element.closest('.se-title-text,.se-section-documentTitle,.se-caption')) {
          const text = [...element.querySelectorAll('.__se-node')]
            .map((n) => (n as HTMLElement).innerText)
            .join('');
          if (text.trim())
            blocks.push({
              kind: element.closest('.se-quotation') ? 'quote' : 'text',
              text,
              alignment: alignment(element),
            });
        }
      }
      return blocks;
    });
  return {
    title: titleText === '제목' ? '' : titleText,
    bodyText: texts.join('\n'),
    images: await pageImagePort(page).read(),
    layout,
  };
}
export async function readDraftCount(page: Page): Promise<number | null> {
  for (const frame of page.frames()) {
    const items = frame.locator(selectors.draftCount);
    for (let i = 0; i < (await items.count()); i++) {
      const item = items.nth(i);
      if (await item.isVisible()) {
        const text = (await item.innerText()).trim();
        if (/^\d+$/.test(text)) return Number(text);
      }
    }
  }
  return null;
}
async function matchingRows(page: Page, title: string): Promise<Locator[]> {
  const rows: Locator[] = [];
  for (const frame of page.frames()) {
    const found = frame
      .locator('button[data-click-area="tpb*s.tlist"]')
      .filter({ has: frame.getByText(title, { exact: true }) });
    for (let i = 0; i < (await found.count()); i++)
      if (await found.nth(i).isVisible()) rows.push(found.nth(i));
  }
  return rows;
}
async function openSavedList(page: Page, title: string): Promise<Locator[]> {
  let rows = await matchingRows(page, title);
  if (!rows.length) await (await firstVisible(page, [selectors.draftCount], 5000)).click();
  const deadline = Date.now() + 5000;
  do {
    rows = await matchingRows(page, title);
    if (rows.length) return rows;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  return [];
}
export async function confirmSavedDraft(
  page: Page,
  draft: PreparedDraft,
  proof: InputProof,
): Promise<SaveReceipt | null> {
  await assertNoExistingDraft(page);
  const deadline = Date.now() + 8000;
  let count: number | null = null;
  do {
    count = await readDraftCount(page);
    if (count !== null && count > proof.beforeCount) break;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  if (count === null || count <= proof.beforeCount) return null;
  // A closing list is not a load boundary: the old manuscript may still be visible.
  // Start from a fresh, verified blank editor so only reopened content can match.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await assertNoExistingDraft(page);
  const blank = await readEditorSnapshot(page);
  if (
    normalizeText(blank.title) ||
    normalizeText(blank.bodyText) ||
    blank.images.length ||
    blank.layout.length
  )
    return null;
  const rows = await openSavedList(page, draft.title);
  if (
    rows.length !== 1 ||
    (await rows[0].locator('..').locator('span[class*="current_post"]').isVisible())
  )
    return null;
  const listText = await rows[0].innerText();
  await rows[0].click();
  const until = Date.now() + 8000;
  do {
    await assertNoExistingDraft(page);
    if (!(await matchingRows(page, draft.title)).length) {
      await assertBlogTarget(page, draft.blogId);
      const snapshot = await readEditorSnapshot(page);
      if (matchesSnapshot(draft, snapshot, proof.receipts, proof.snapshot))
        return {
          schemaVersion: 1,
          jobId: draft.jobId,
          fingerprint: draft.fingerprint,
          title: snapshot.title,
          snapshot,
          confirmedAt: new Date().toISOString(),
          identity: { listText, reopenedUrl: page.url() },
        };
    }
    await page.waitForTimeout(150);
  } while (Date.now() < until);
  return null;
}
export async function openEditorPort(
  config: Config,
  draft: PreparedDraft,
  targetId?: string,
): Promise<EditorPort> {
  const session = await openSession(config, { blogId: draft.blogId }, targetId);
  return createEditorPort(session.page, draft, session.targetId, () => session.release());
}
export function createEditorPort(
  page: Page,
  draft: PreparedDraft,
  targetId: string,
  release: () => Promise<void>,
): EditorPort {
  const writer = new TextWriter(pageTextPort(page, 'fast'));
  return {
    targetId,
    verify: async () => {
      const result = await probePageSession(page);
      if (result !== 'authenticated') throw Error('needs_user:' + result);
      await assertBlogTarget(page, draft.blogId);
      await assertNoExistingDraft(page);
    },
    prepare: () => prepareBlankEditor(page),
    count: () => readDraftCount(page),
    snapshot: () => readEditorSnapshot(page),
    apply: async (event, current) => {
      if (event.type === 'insertImage') {
        await writer.prepareImage();
        const asset = current.assets.find((a) => a.assetId === event.assetId);
        if (!asset) throw Error('unknown_asset');
        return insertImage(page, event, asset);
      }
      if (event.type === 'setImageCaption') {
        await setImageCaption(page, event.text);
        return;
      }
      await writer.apply(event);
    },
    save: async () => {
      await (await firstVisible(page, selectors.draftSave, 5000)).click({ timeout: 5000 });
    },
    confirm: (d, p) => confirmSavedDraft(page, d, p),
    release,
  };
}
