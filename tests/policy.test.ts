import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { samplePost, sampleResearch } from './helpers.js';
import { validatePost, validateBodyStyleWarnings } from '../src/editorial/post.js';
import { resolveConfig } from '../src/config.js';
import { initJob, readJob } from '../src/state/jobs.js';
import { readJson } from '../src/state/files.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const request = {
  conditions: {
    bodyMin: 1000,
    bodyMax: 1600,
    sectionCount: 4,
    sectionMin: 4,
    sectionMax: 6,
    imagesPerSection: 2,
    imageMin: 10,
    imageMax: 12,
  },
} as any;
function post() {
  const p = samplePost();
  p.titleCandidates = Array.from(
    { length: 7 },
    (_, i) => `${i + 1}년 만에 공개한 배우의 새로운 작품 이야기와 달라진 근황을 확인했어요`,
  );
  p.title = p.titleCandidates[0];
  (p as any).titleTemplateIds = [1, 2, 3, 4, 5, 6, 7];
  p.tags = ['테스트', '자료', '발표', '이슈', '정리', '배우', '작품', '소식', '근황', '방송'];
  return p;
}
it('accepts seven compliant titles and ten tags', () => {
  expect(validatePost(request, sampleResearch(), post())).toEqual([]);
});
it('rejects five candidates instead of silently treating them as seven', () => {
  const p = post();
  p.titleCandidates = p.titleCandidates.slice(0, 5);
  expect(validatePost(request, sampleResearch(), p)).toContain('title_candidates');
});
it.each([
  ['제목!', 'title_length:0'],
  ['가'.repeat(51), 'title_length:0'],
  ['가'.repeat(35), 'title_number_required:0'],
  ['1' + '가'.repeat(34) + '!', 'title_symbol_forbidden:0'],
  ['1' + '가'.repeat(34) + '…', 'title_symbol_forbidden:0'],
])('rejects title policy violation %s', (title, error) => {
  const p = post();
  p.titleCandidates[0] = title;
  p.title = title;
  expect(validatePost(request, sampleResearch(), p)).toContain(error);
});
it('checks unselected candidates too', () => {
  const p = post();
  p.titleCandidates[6] = '짧은 제목!';
  expect(validatePost(request, sampleResearch(), p)).toContain('title_length:6');
});
it.each([35, 45, 50])('accepts a %s-character title', (count) => {
  const p = post();
  p.titleCandidates[0] = '1' + '가'.repeat(count - 1);
  p.title = p.titleCandidates[0];
  expect(validatePost(request, sampleResearch(), p)).toEqual([]);
});
it('warns rather than rejects a title over the recommended 45 characters', () => {
  const p = post();
  p.titleCandidates[0] = '1' + '가'.repeat(45);
  p.title = p.titleCandidates[0];
  expect(validatePost(request, sampleResearch(), p)).toEqual([]);
  expect(validateBodyStyleWarnings(p)).toContain('title_length_recommended:0:chars=46>45');
});
it.each([{ ids: undefined }, { ids: [1, 1, 2, 3, 4, 5, 6] }, { ids: [1, 2, 3, 4, 5, 6, 99] }])(
  'requires seven distinct known template IDs: $ids',
  ({ ids }) => {
    const p = post();
    (p as any).titleTemplateIds = ids;
    expect(validatePost(request, sampleResearch(), p)).toContain('title_templates');
  },
);
it('requires exactly ten tags', () => {
  const p = post();
  p.tags = p.tags.slice(0, 5);
  expect(validatePost(request, sampleResearch(), p)).toContain('tags');
});
it('initializes usable defaults without a local config file and enforces the same limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nblog-policy-'));
  roots.push(root);
  const config = await resolveConfig({ blogId: 'test-blog' }, root);
  const job = await initJob(config, '테스트 주제'),
    req = await readJob(job),
    blank = await readJson<any>(join(job, 'post.json'));
  expect(blank.sections.reduce((n: number, s: any) => n + s.images.length, 0)).toBe(12);
  expect(validatePost(req, sampleResearch(), { ...post(), intro: samplePost(1500).intro })).toEqual(
    [],
  );
  const over = post();
  over.sections[0].images.push({
    slotId: 'extra',
    mode: 'download',
    query: '새 장면',
    engine: 'google',
  });
  expect(validatePost(req, sampleResearch(), over)).toContain('image_count');
});
