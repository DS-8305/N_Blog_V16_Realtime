import { it, expect, afterEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers.js';
import { preparePost, recordReview, loadDraft } from '../src/editorial/bundle.js';
import { runDraft, type EditorPort } from '../src/automation/runner.js';
import { readJson, atomicJson } from '../src/state/files.js';
import type {
  PreparedDraft,
  Snapshot,
  EditorEvent,
  ImageReceipt,
  SaveReceipt,
} from '../src/domain/types.js';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
class MemoryEditor implements EditorPort {
  targetId = 'owned-tab';
  current: Snapshot = { title: '', bodyText: '', images: [], layout: [] };
  saveCount = 0;
  dispatches: string[] = [];
  failOn: string | undefined;
  failSave = false;
  badConfirmation = false;
  delayFirstUpload = false;
  async verify() {}
  async prepare() {
    if (this.current.title || this.current.bodyText || this.current.images.length)
      throw Error('not_blank');
  }
  async count() {
    return 2;
  }
  async snapshot() {
    return structuredClone(this.current);
  }
  async release() {}
  async apply(event: EditorEvent, draft: PreparedDraft): Promise<ImageReceipt | undefined> {
    const key = event.type === 'insertImage' ? event.assetId : event.type + ':' + event.text;
    this.dispatches.push(key);
    let receipt: ImageReceipt | undefined;
    if (event.type === 'setTitle') this.current.title = event.text;
    else if (event.type === 'insertImage') {
      if (this.delayFirstUpload) {
        this.delayFirstUpload = false;
        throw Error('upload_dispatched_but_not_visible');
      }
      const a = draft.assets.find((a) => a.assetId === event.assetId)!;
      const index = this.current.images.length;
      const blockKey = 'block-' + index;
      this.current.images.push({
        key: blockKey,
        src: `https://blogfiles.pstatic.net/${a.assetId}.png`,
        loaded: true,
        width: a.width,
        height: a.height,
      });
      this.current.layout.push({
        kind: 'image',
        key: blockKey,
        caption: '',
        captionAlignment: null,
      });
      receipt = { assetId: a.assetId, index, blockKey, confirmedAt: new Date().toISOString() };
    } else {
      this.current.bodyText += (this.current.bodyText ? '\n' : '') + event.text;
      if (event.type === 'setImageCaption') {
        const block = this.current.layout.at(-1);
        if (block?.kind === 'image') {
          block.caption = event.text;
          block.captionAlignment = 'center';
        }
      } else
        for (const line of event.text.split('\n').filter((line) => line.trim()))
          this.current.layout.push({
            kind: event.type === 'insertQuote' ? 'quote' : 'text',
            text: line,
            alignment: 'center',
          });
    }
    if (this.failOn === key) {
      this.failOn = undefined;
      throw Error('simulated_disconnect');
    }
    return receipt;
  }
  async save() {
    this.saveCount++;
    if (this.failSave) {
      this.failSave = false;
      throw Error('simulated_save_disconnect');
    }
  }
  async confirm(draft: PreparedDraft): Promise<SaveReceipt | null> {
    if (this.badConfirmation) return null;
    return {
      schemaVersion: 1,
      jobId: draft.jobId,
      fingerprint: draft.fingerprint,
      title: this.current.title,
      snapshot: await this.snapshot(),
      confirmedAt: new Date().toISOString(),
      identity: {
        listText: 'persisted unique title',
        reopenedUrl: 'https://blog.naver.com/PostWriteForm.naver?blogId=test-blog',
      },
    };
  }
}
async function ready(extra = false) {
  const f = await fixture(1000, extra);
  roots.push(f.root);
  const b = await preparePost(f.job);
  await recordReview(f.job, b.fingerprint, 'offline-test');
  return f;
}
it('returns the verified receipt after 73 hours without opening the browser again', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  expect((await runDraft(f.job, f.config, { open: async () => port })).status).toBe('draft_saved');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 73 * 60 * 60 * 1000);
  const result = await runDraft(f.job, f.config, {
    resume: true,
    open: async () => {
      throw Error('must_not_open');
    },
  });
  expect(result.status).toBe('draft_saved');
  expect(port.saveCount).toBe(1);
});
it('reconciles a pending save after 73 hours without inserting or clicking save again', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  port.failSave = true;
  expect((await runDraft(f.job, f.config, { open: async () => port })).status).toBe(
    'draft_unconfirmed',
  );
  const dispatched = port.dispatches.length;
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 73 * 60 * 60 * 1000);
  expect((await runDraft(f.job, f.config, { resume: true, open: async () => port })).status).toBe(
    'draft_saved',
  );
  expect(port.dispatches).toHaveLength(dispatched);
  expect(port.saveCount).toBe(1);
});
it('does not bypass freshness for a new stale draft by passing resume', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 73 * 60 * 60 * 1000);
  const result = await runDraft(f.job, f.config, { resume: true, open: async () => port });
  expect(result.code).toContain('research_stale');
  expect(port.dispatches).toHaveLength(0);
  expect(port.saveCount).toBe(0);
});
it('saves and verifies thirteen images once and returns the confirmed receipt on another run', async () => {
  const f = await ready(true),
    port = new MemoryEditor();
  const first = await runDraft(f.job, f.config, { open: async () => port });
  expect(first.status).toBe('draft_saved');
  expect(port.saveCount).toBe(1);
  expect(port.current.images).toHaveLength(13);
  const again = await runDraft(f.job, f.config, {
    open: async () => {
      throw Error('should_not_reconnect');
    },
  });
  expect(again.status).toBe('draft_saved');
  expect(
    (await readJson<any>(join(f.job, 'receipts/draft-save.json'))).snapshot.images,
  ).toHaveLength(13);
});
it('never clicks save again after a save dispatch throws', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  port.failSave = true;
  expect((await runDraft(f.job, f.config, { open: async () => port })).status).toBe(
    'draft_unconfirmed',
  );
  expect(port.saveCount).toBe(1);
  expect((await runDraft(f.job, f.config, { resume: true, open: async () => port })).status).toBe(
    'draft_saved',
  );
  expect(port.saveCount).toBe(1);
});
it('acknowledges an applied text event on resume without duplicating its text', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  port.failOn = 'insertQuote:항목1';
  expect((await runDraft(f.job, f.config, { open: async () => port })).status).toBe(
    'input_unconfirmed',
  );
  expect((await runDraft(f.job, f.config, { resume: true, open: async () => port })).status).toBe(
    'draft_saved',
  );
  expect(port.dispatches.filter((x) => x === 'insertQuote:항목1')).toHaveLength(1);
});
it('does not replay an image whose upload dispatched but was not acknowledged', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  port.failOn = 's1-1';
  expect((await runDraft(f.job, f.config, { open: async () => port })).status).toBe(
    'input_unconfirmed',
  );
  expect((await runDraft(f.job, f.config, { resume: true, open: async () => port })).status).toBe(
    'input_unconfirmed',
  );
  expect(port.current.images).toHaveLength(1);
  expect(port.dispatches.filter((x) => x === 's1-1')).toHaveLength(1);
  expect(port.saveCount).toBe(0);
});
it('stops when the saved draft cannot be identified uniquely', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  port.badConfirmation = true;
  expect((await runDraft(f.job, f.config, { open: async () => port })).status).toBe(
    'draft_unconfirmed',
  );
  expect((await runDraft(f.job, f.config, { resume: true, open: async () => port })).status).toBe(
    'draft_unconfirmed',
  );
  expect(port.saveCount).toBe(1);
});
it('does not resume the same editor through a different port', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  port.failOn = 'insertQuote:항목1';
  await runDraft(f.job, f.config, { open: async () => port });
  const result = await runDraft(
    f.job,
    { ...f.config, cdpEndpoint: 'http://127.0.0.1:9226' },
    { resume: true, open: async () => port },
  );
  expect(result.status).toBe('needs_user');
  expect(result.code).toContain('resume_session_changed');
});
it('does not replay a dispatched upload while its image is still absent', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  port.delayFirstUpload = true;
  expect((await runDraft(f.job, f.config, { open: async () => port })).status).toBe(
    'input_unconfirmed',
  );
  expect(port.current.images).toHaveLength(0);
  expect((await runDraft(f.job, f.config, { resume: true, open: async () => port })).status).toBe(
    'input_unconfirmed',
  );
  expect(port.dispatches.filter((x) => x === 's1-1')).toHaveLength(1);
  expect(port.saveCount).toBe(0);
});
it('recovers a verified checkpoint committed just before its intent was removed', async () => {
  const f = await ready(),
    port = new MemoryEditor();
  port.failOn = 'insertQuote:항목1';
  await runDraft(f.job, f.config, { open: async () => port });
  const path = join(f.job, 'checkpoints/progress.json'),
    progress = await readJson<any>(path);
  await atomicJson(path, {
    ...progress,
    index: progress.index + 1,
    snapshot: await port.snapshot(),
  });
  expect((await runDraft(f.job, f.config, { resume: true, open: async () => port })).status).toBe(
    'draft_saved',
  );
  expect(port.dispatches.filter((x) => x === 'insertQuote:항목1')).toHaveLength(1);
});
