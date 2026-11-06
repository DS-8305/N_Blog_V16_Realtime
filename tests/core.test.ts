import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig, normalizeEndpoint, assertDedicatedChromeProfile } from '../src/config.js';
import { initJob, readJob, assertMutable } from '../src/state/jobs.js';
import { safeFile, readJson, atomicJson, acquireLock } from '../src/state/files.js';
import { validateResearch, dateValue } from '../src/domain/validation.js';

const roots: string[] = [];
async function temp() {
  const p = await mkdtemp(join(tmpdir(), 'nblog-'));
  roots.push(p);
  return p;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
describe('configuration and isolated jobs', () => {
  it('initializes a usable twelve-image request on CDP 9225', async () => {
    const root = await temp(),
      config = await resolveConfig({ blogId: 'my-blog' }, root);
    const path = await initJob(config, '실시간 주제'),
      request = await readJob(path);
    expect(config.cdpEndpoint).toBe('http://127.0.0.1:9225');
    expect(config.googleCdpEndpoint).toBe('http://127.0.0.1:9230');
    expect(config.googleProfilePath).not.toBe(config.profilePath);
    expect(request.conditions).toEqual({
      bodyMin: 1000,
      bodyMax: 1600,
      sectionCount: 4,
      sectionMin: 4,
      sectionMax: 6,
      imagesPerSection: 2,
      imageMin: 10,
      imageMax: 12,
    });
    expect(request.blogId).toBe('my-blog');
    expect(request.timezone).toBe('Asia/Seoul');
    expect((await readJson<any>(join(path, 'state.json'))).phase).toBe('initialized');
    const post = await readJson<any>(join(path, 'post.json'));
    expect(post.sections).toHaveLength(4);
    expect(post.sections.every((s: any) => s.images.length === 3)).toBe(true);
  });
  it('uses explicit options before the project configuration', async () => {
    const root = await temp();
    await writeFile(
      join(root, 'nblog.config.json'),
      JSON.stringify({ cdpEndpoint: 'http://localhost:9555', blogId: 'config-blog' }),
    );
    const config = await resolveConfig({ cdp: 'http://127.0.0.1:9444', blogId: 'chosen' }, root);
    expect(config.cdpEndpoint).toBe('http://127.0.0.1:9444');
    expect(config.blogId).toBe('chosen');
  });
  it.each([
    'https://remote.example:9225',
    'http://127.0.0.1.evil.test:9225',
    'http://user:pass@localhost:9225',
    'http://localhost:9225/path',
    'http://localhost:9225?x=1',
  ])('rejects unsafe CDP %s', (value) => expect(() => normalizeEndpoint(value)).toThrow());
  it('rejects the default Chrome profile for either dedicated session', () => {
    expect(() =>
      assertDedicatedChromeProfile('/home/user/.config/google/chrome/user data/Default'),
    ).toThrow('chrome_default_profile_forbidden');
  });
  it('refuses modifications once input has started', async () => {
    const root = await temp(),
      path = await initJob(await resolveConfig({ blogId: 'test' }, root), '테스트');
    await atomicJson(join(path, 'input-intent.json'), { index: 0 });
    await expect(assertMutable(path)).rejects.toThrow('job_immutable');
  });
  it('blocks outside paths and junctions, including non-existing output beneath them', async () => {
    const root = await temp(),
      outside = await temp();
    await mkdir(join(root, 'images'));
    await expect(safeFile(root, '../escape.png')).rejects.toThrow();
    await symlink(outside, join(root, 'linked'), 'junction');
    await expect(safeFile(root, 'linked/new.png')).rejects.toThrow('path_outside_job');
    expect(await safeFile(root, 'images/new.png')).toBe(join(root, 'images/new.png'));
  });
  it('does not allow overlapping lock holders', async () => {
    const root = await temp(),
      unlock = await acquireLock(join(root, 'lock'));
    await expect(acquireLock(join(root, 'lock'))).rejects.toThrow('locked');
    await unlock();
    const again = await acquireLock(join(root, 'lock'));
    await again();
  });
  it('rejects unknown source links and invalid source dates', () => {
    const result = validateResearch({ createdAt: '2026-10-20T00:00:00Z' } as any, {
      schemaVersion: 1,
      researchedAt: '2026-10-20T00:00:00Z',
      sources: [
        {
          sourceId: 's1',
          title: '발표',
          publisher: '기관',
          url: 'https://example.org/news',
          publishedAt: 'bad',
          updatedAt: null,
          accessedAt: '2026-10-20T00:00:00Z',
        },
      ],
      facts: [{ factId: 'f1', text: '확인한 사실', sourceIds: ['missing'] }],
    });
    expect(result).toContain('source_date:s1');
    expect(result).toContain('fact_source:f1');
  });
  it('accepts actual Seoul timestamps while rejecting nonexistent calendar dates', () => {
    expect(dateValue('2026-10-20T00:30:00+09:00')).toBe(true);
    expect(dateValue('2026-02-30')).toBe(false);
  });
});
