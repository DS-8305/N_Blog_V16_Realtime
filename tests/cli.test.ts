import { it, expect, afterEach, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture } from './helpers.js';
import { atomicJson } from '../src/state/files.js';
const roots: string[] = [];
const cli = resolve('dist/cli.js');
beforeAll(() => {
  const r = spawnSync(process.execPath, ['build.mjs'], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
function run(args: string[], cwd = process.cwd()) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { ...r, data: () => JSON.parse(r.stdout) };
}
it('lists pending images and rejects invalid search options before connecting to a browser', async () => {
  const f = await fixture();
  roots.push(f.root);
  const listed = run(['image:candidates', '--job', f.job], f.root);
  expect(listed.status, listed.stderr).toBe(0);
  expect(listed.data().candidates).toEqual([]);
  expect(
    run(['image:search', '--job', f.job, '--query', 'person', '--max-queries', '4'], f.root).stderr,
  ).toContain('image_query_batch_limit');
  expect(
    run(
      [
        'image:select',
        '--job',
        f.job,
        '--slot',
        's1-1',
        '--candidate',
        'img-1234567890abcdef',
        '--source-id',
        's1',
        '--reviewer',
        'Codex',
        '--origin-kind',
        'personal',
        '--origin-url',
        'https://example.org/news',
        '--note',
        'private origin',
      ],
      f.root,
    ).stderr,
  ).toContain('image_origin_unverified:personal');
});
it('initializes a job from the built CLI using default manuscript and image counts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nblog-cli-'));
  roots.push(root);
  const result = run(['job:init', '--topic', '테스트 이슈', '--blog-id', 'demo-blog'], root);
  expect(result.status, result.stderr).toBe(0);
  const info = result.data();
  expect(info.cdpEndpoint).toBe('http://127.0.0.1:9225');
  expect(info.imageCount).toBe(12);
  expect(info.bodyRange).toEqual([1000, 1600]);
  expect(run(['research:check', '--job', info.jobPath], root).status).toBe(2);
});
it('prepares an explicitly configured thirteen-image manuscript without connecting to Naver', async () => {
  const f = await fixture(1000, true);
  roots.push(f.root);
  const prepared = run(['post:prepare', '--job', f.job], f.root);
  expect(prepared.status, prepared.stderr).toBe(0);
  expect(prepared.data().imageCount).toBe(13);
  const reviewed = run(
    [
      'post:review',
      '--job',
      f.job,
      '--fingerprint',
      prepared.data().fingerprint,
      '--reviewer',
      'test',
    ],
    f.root,
  );
  expect(reviewed.status, reviewed.stderr).toBe(0);
  const checked = run(['draft:check', '--job', f.job], f.root);
  expect(checked.status, checked.stderr).toBe(0);
  expect(checked.data().imageCount).toBe(13);
});
it('reports title similarity on post:check and rejects a copied article title', async () => {
  const f = await fixture();
  roots.push(f.root);
  f.research.sources[0].title = '가-나 다 라 바';
  await atomicJson(join(f.job, 'research.json'), f.research);
  const valid = run(['post:check', '--job', f.job], f.root);
  expect(valid.status, valid.stderr).toBe(0);
  expect(valid.data().titleSimilarities).toEqual([
    {
      sourceId: 's1',
      articleTitle: '가-나 다 라 바',
      jaccardPercent: 0,
      articleCoveragePercent: 0,
    },
  ]);
  f.post.titleCandidates[0] = '가 나,다!라 마';
  f.post.title = f.post.titleCandidates[0];
  await atomicJson(join(f.job, 'post.json'), f.post);
  const rejected = run(['post:check', '--job', f.job], f.root);
  expect(rejected.status).toBe(2);
  expect(JSON.parse(rejected.stderr).code).toContain(
    'title_overlap:s1:jaccard=60%:articleCoverage=75%',
  );
});
it('rejects unknown arguments and remote Chrome endpoints', () => {
  expect(run(['job:init', '--typo', 'value']).status).toBe(2);
  expect(run(['doctor', '--cdp', 'http://example.org:9225']).status).toBe(2);
});
