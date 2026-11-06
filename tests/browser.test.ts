import { it, expect } from 'vitest';
import { chromium } from 'playwright';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture } from './helpers.js';
import { preparePost, recordReview, loadDraft } from '../src/editorial/bundle.js';
import { runDraft } from '../src/automation/runner.js';
import {
  createEditorPort,
  confirmSavedDraft,
  readEditorSnapshot,
} from '../src/automation/editorPort.js';
import { assertBlogTarget, probePageSession } from '../src/automation/sessionProbe.js';
import { captureRegion } from '../src/capture/captureRegion.js';
import { pageTextPort } from '../src/automation/textWriter.js';
import { setImageCaption } from '../src/automation/imageCaption.js';
import { focusNormalBody, setCenterAlignment } from '../src/automation/editorHelpers.js';
const browserTest = process.env.NBLOG_BROWSER_TESTS === '1' ? it : it.skip;
browserTest('does not require paragraph alignment controls for an already centered image caption', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage(),
      html = await readFile(resolve('tests/fixtures/editor.html'), 'utf8');
    await page.setContent(html);
    await page.locator('button[data-group="propertyToolbar"][data-type="drop-down"]').evaluate(
      (button) => button.remove(),
    );
    await page.locator('.se-components-wrap').evaluate((container) => {
      container.insertAdjacentHTML(
        'beforeend',
        '<div class="se-component se-image"><div class="se-module-image"><img src="https://assets.test/caption.png"></div><div class="se-caption"><p class="se-text-paragraph se-text-paragraph-align-center" contenteditable="true"><span class="__se-node"></span></p></div></div>',
      );
    });

    await setImageCaption(page, '공식 사진 설명');

    expect(await page.locator('.se-caption .__se-node').innerText()).toBe('공식 사진 설명');
  } finally {
    await browser.close();
  }
});
browserTest('does not reopen the alignment menu when the current paragraph is centered', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage(),
      html = await readFile(resolve('tests/fixtures/editor.html'), 'utf8');
    await page.setContent(html);
    const paragraph = page.locator('.se-components-wrap .se-text-paragraph').first(),
      button = page.locator('button[data-group="propertyToolbar"][data-type="drop-down"]');
    await paragraph.evaluate((element) =>
      element.classList.add('se-text-paragraph-align-center'),
    );
    await button.evaluate((element) => {
      element.setAttribute(
        'class',
        'se-property-toolbar-drop-down-button se-align-center-toolbar-button',
      );
      element.addEventListener('click', () => {
        element.dataset.clickCount = String(Number(element.dataset.clickCount ?? 0) + 1);
      });
    });

    await setCenterAlignment(page);

    expect(await button.getAttribute('data-click-count')).toBeNull();
  } finally {
    await browser.close();
  }
});
browserTest('uses quote 1 for centered bold section headings', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage(),
      html = await readFile(resolve('tests/fixtures/editor.html'), 'utf8');
    await page.setContent(html);
    await pageTextPort(page, 'fast').quote('테스트 소제목', true);
    const quote = page.locator('.se-quotation');
    expect(await quote.getAttribute('data-quotation-style')).toBe('default');
    expect(await quote.locator('.se-text-paragraph').getAttribute('data-bold-applied')).toBe(
      'true',
    );
    expect(await quote.innerText()).toContain('테스트 소제목');
  } finally {
    await browser.close();
  }
});
browserTest(
  'starts after an existing paragraph when an editor restores focus to the first wrapped line',
  async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      const text =
        '원래 본문의 긴 문장이 여러 줄로 보이더라도 링크와 다음 문단이 중간에 끼어들면 안 됩니다. '.repeat(
          4,
        );
      await page.setContent(
        '<div class="se-components-wrap" contenteditable="true"><div class="se-component se-text"><div class="se-module-text"><p class="se-text-paragraph" style="width:180px;min-height:24px"></p></div></div></div>',
      );
      await page.locator('p').fill(text);
      await page.locator('p').evaluate((p) =>
        p.addEventListener('mousedown', (e) => {
          e.preventDefault();
          p.focus();
          const r = document.createRange();
          r.setStart(p.firstChild!, 0);
          r.collapse(true);
          const s = getSelection()!;
          s.removeAllRanges();
          s.addRange(r);
        }),
      );
      await page.evaluate(() =>
        document.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.key === 'End') e.preventDefault();
        }),
      );
      await focusNormalBody(page, 'last');
      await page.keyboard.insertText('추가');
      expect((await page.locator('p').first().textContent())?.replaceAll('\u00a0', ' ')).toBe(text);
      expect(await page.locator('p').last().textContent()).toBe('추가');
    } finally {
      await browser.close();
    }
  },
);
browserTest(
  'finishes a text insertion before Enter when the editor restores its caret asynchronously',
  async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<div contenteditable="true"><p id="paragraph" style="min-height:24px"></p></div><script>
      document.addEventListener('input', e => {
        const p=document.querySelector('#paragraph');
        if (!p.firstChild || e.inputType !== 'insertText') return;
        const end=p.textContent.length, s=getSelection(), r=document.createRange();
        r.setStart(p.firstChild, Math.min(12,end));r.collapse(true);s.removeAllRanges();s.addRange(r);
        setTimeout(()=>{if(!p.firstChild)return;const r=document.createRange();r.selectNodeContents(p);r.collapse(false);s.removeAllRanges();s.addRange(r)},150);
      });</script>`);
      await page.locator('#paragraph').click();
      const writer = pageTextPort(page, 'fast'),
        text = '첫 문장이 중간에서 잘리지 않고 원래 문단 끝에 줄바꿈을 넣어야 합니다.';
      await writer.type(text);
      await writer.enter();
      expect(await page.locator('#paragraph').first().innerText()).toBe(text);
    } finally {
      await browser.close();
    }
  },
);
browserTest(
  'waits for a delayed editor iframe without masking a login or captcha page',
  async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<script>setTimeout(()=>{const f=document.createElement("iframe");f.srcdoc="<div class=se-components-wrap>editor</div>";document.body.append(f)},350)</script>',
      );
      expect(await probePageSession(page)).toBe('authenticated');
      await page.setContent('<input id="captcha">');
      expect(await probePageSession(page)).toBe('security_check');
      await page.route('https://nid.naver.com/**', (r) => r.fulfill({ body: 'login' }));
      await page.goto('https://nid.naver.com/nidlogin.login');
      expect(await probePageSession(page)).toBe('login_required');
    } finally {
      await browser.close();
    }
  },
);
browserTest(
  'rejects delayed saved content rather than confirming the still-matching live editor',
  async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext();
      const html = await readFile(resolve('tests/fixtures/editor.html'), 'utf8');
      await context.route('https://blog.naver.com/**', (r) =>
        r.fulfill({ contentType: 'text/html', body: html }),
      );
      const page = await context.newPage();
      await page.goto(
        'https://blog.naver.com/PostWriteForm.naver?blogId=test-blog&omitCurrent=1&delay=1200',
      );
      await page.evaluate(() => {
        document.querySelector('.se-title-text .__se-node')!.textContent = '테스트 제목';
        document.querySelector('.se-components-wrap .__se-node')!.textContent = '본문';
        const html = document
          .querySelector('.se-components-wrap')!
          .innerHTML.replace('본문', '서버 내용 불일치');
        localStorage.setItem('saved-drafts', JSON.stringify([{ title: '테스트 제목', html }]));
        document.querySelector('.save_count_btn')!.textContent = '1';
      });
      const draft: any = {
        jobId: 'test',
        fingerprint: 'test',
        blogId: 'test-blog',
        title: '테스트 제목',
        events: [
          { type: 'setTitle', text: '테스트 제목' },
          { type: 'typeText', text: '본문' },
        ],
        assets: [],
        expected: { bodyText: '본문', imageAssetIds: [], captions: [], sources: [] },
      };
      const proof = { snapshot: await readEditorSnapshot(page), receipts: [], beforeCount: 0 };
      expect(await confirmSavedDraft(page, draft, proof)).toBeNull();
    } finally {
      await browser.close();
    }
  },
  30000,
);
browserTest(
  'writes twelve real PNG uploads with native captions and reopens persisted contents',
  async () => {
    const f = await fixture(),
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext();
      const html = await readFile(resolve('tests/fixtures/editor.html'), 'utf8');
      await context.route('https://blog.naver.com/**', (r) =>
        r.fulfill({ contentType: 'text/html', body: html }),
      );
      await context.route('https://assets.test/**', async (r) => {
        const filename = decodeURIComponent(new URL(r.request().url()).pathname.slice(1));
        await r.fulfill({
          contentType: 'image/png',
          body: await readFile(join(f.job, 'images', filename)),
        });
      });
      const page = await context.newPage();
      await page.goto('https://blog.naver.com/PostWriteForm.naver?blogId=test-blog');
      const basis = await preparePost(f.job);
      await recordReview(f.job, basis.fingerprint, 'local-browser-test');
      const result = await runDraft(f.job, f.config, {
        open: async (_c, d) => createEditorPort(page, d, 'fixture-tab', async () => {}),
      });
      if (result.status !== 'draft_saved') {
        await mkdir('.runtime', { recursive: true });
        await writeFile(
          '.runtime/browser-input-failure.json',
          JSON.stringify(
            {
              result,
              intent: JSON.parse(await readFile(join(f.job, 'input-intent.json'), 'utf8')),
              progress: JSON.parse(
                await readFile(join(f.job, 'checkpoints/progress.json'), 'utf8'),
              ),
              current: await readEditorSnapshot(page),
              events: (await loadDraft(f.job)).events,
            },
            null,
            2,
          ),
        );
      }
      expect(result, result.code).toMatchObject({ status: 'draft_saved' });
      expect(result.receipt?.snapshot.images).toHaveLength(12);
      expect(await page.locator('.se-caption').count()).toBe(12);
      expect(await page.locator('.save_count_btn').innerText()).toBe('1');
      await expect(assertBlogTarget(page, 'different-blog')).rejects.toThrow(
        'blog_target_unconfirmed',
      );
    } finally {
      await browser.close();
      await rm(f.root, { recursive: true, force: true });
    }
  },
  120000,
);
browserTest(
  'captures a real visible region and rejects a floating overlay',
  async () => {
    const f = await fixture(),
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
      await page.setContent(
        '<section id="source" style="width:600px;height:300px;background:#eee">공식 발표 자료</section>',
      );
      const result = await captureRegion({
        page,
        locator: page.locator('#source'),
        outputPath: join(f.root, 'screen.png'),
        requiredLabels: ['공식 발표'],
      });
      expect(result.width).toBe(600);
      expect(result.height).toBe(300);
      await page.evaluate(() => {
        const mask = document.createElement('div');
        mask.style.cssText =
          'position:fixed;left:8px;top:8px;width:600px;height:300px;background:red;z-index:1000';
        document.body.append(mask);
      });
      await expect(
        captureRegion({
          page,
          locator: page.locator('#source'),
          outputPath: join(f.root, 'blocked.png'),
          requiredLabels: ['공식 발표'],
        }),
      ).rejects.toThrow('region_occluded');
    } finally {
      await browser.close();
      await rm(f.root, { recursive: true, force: true });
    }
  },
  30000,
);
