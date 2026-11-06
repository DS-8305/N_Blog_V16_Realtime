import { afterEach, expect, it } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers.js';
import { atomicJson, fingerprint } from '../src/state/files.js';
import { preparePost, recordReview, loadDraft } from '../src/editorial/bundle.js';
import { validatePost } from '../src/editorial/post.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('alternates each image with its body sentence in both preview and editor events', async () => {
  const f = await fixture();
  roots.push(f.root);
  f.post.sections[0].paragraphs = [
    '첫 번째 사진 뒤에\n들어갈 문장이에요.',
    '두 번째 사진 뒤에\n들어갈 문장이에요.',
    '세 번째 사진 뒤에\n들어갈 문장이에요.',
  ];
  await atomicJson(join(f.job, 'post.json'), f.post);
  await atomicJson(join(f.job, 'assets.json'), {
    schemaVersion: 1,
    planFingerprint: fingerprint({ request: f.request, post: f.post }),
    assets: f.assets,
  });
  const prepared = await preparePost(f.job);
  await recordReview(f.job, prepared.fingerprint, 'test');
  const draft = await loadDraft(f.job);
  const start = draft.events.findIndex((e) => e.type === 'insertQuote' && e.text === '항목1');
  expect(
    draft.events
      .slice(start, start + 8)
      .map((e) =>
        e.type === 'insertImage'
          ? e.assetId
          : e.type === 'typeText'
            ? e.text
            : e.type === 'insertQuote'
              ? e.text
              : e.type,
      ),
  ).toEqual([
    '항목1',
    's1-1',
    '첫 번째 사진 뒤에\n들어갈 문장이에요.',
    's1-2',
    '두 번째 사진 뒤에\n들어갈 문장이에요.',
    's1-3',
    '세 번째 사진 뒤에\n들어갈 문장이에요.',
    '항목2',
  ]);
  const preview = await readFile(join(f.job, 'preview.md'), 'utf8');
  const positions = [
    '## 항목1',
    '![s1-1]',
    '첫 번째 사진 뒤에',
    '![s1-2]',
    '두 번째 사진 뒤에',
    '![s1-3]',
    '세 번째 사진 뒤에',
    '## 항목2',
  ].map((text) => preview.indexOf(text));
  expect(
    positions.every(
      (position, index) => position >= 0 && (index === 0 || position > positions[index - 1]),
    ),
  ).toBe(true);
  expect(draft.events.some((e) => e.type === 'setImageCaption')).toBe(false);
});
it.each([1, 4])('rejects %s body entries when a section has three images', async (count) => {
  const f = await fixture();
  roots.push(f.root);
  f.post.sections[0].paragraphs = Array.from({ length: count }, () => '본문 문장이에요.');
  expect(validatePost(f.request, f.research, f.post)).toContain('section_text_image_count:sec1');
});
