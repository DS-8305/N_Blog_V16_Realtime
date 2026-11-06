import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './helpers.js';
import { atomicJson, fingerprint } from '../src/state/files.js';
import { imagePlanFingerprint } from '../src/images/plan.js';
import { validateAssets } from '../src/images/assets.js';
import { collectImages } from '../src/images/collect.js';
import { captureImages } from '../src/capture/capture.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('rejects a personal blog source before fetching its apparently neutral CDN image', async () => {
  const f = await fixture();
  roots.push(f.root);
  f.research.sources[0].url = 'https://blog.naver.com/ordinary-person/123';
  f.post.sections[0].images[0] = {
    slotId: 's1-1',
    mode: 'download',
    engine: 'direct',
    query: 'private reprint',
    sourceId: 's1',
    imageUrl: 'https://example.org/photo.png',
    originKind: 'publisher',
  };
  await atomicJson(join(f.job, 'research.json'), f.research);
  await atomicJson(join(f.job, 'post.json'), f.post);
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('must not request'));
  await expect(collectImages(f.job, f.config, 's1-1')).rejects.toThrow(/image_source_disallowed/);
  expect(fetch).not.toHaveBeenCalled();
});
it('requires origin review for a direct media download before any request', async () => {
  const f = await fixture();
  roots.push(f.root);
  f.post.sections[0].images[0] = {
    slotId: 's1-1',
    mode: 'download',
    engine: 'direct',
    query: 'unverified origin',
    sourceId: 's1',
    imageUrl: 'https://example.org/photo.png',
  };
  await atomicJson(join(f.job, 'post.json'), f.post);
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('must not request'));
  await expect(collectImages(f.job, f.config, 's1-1')).rejects.toThrow(/image_origin_unverified/);
  expect(fetch).not.toHaveBeenCalled();
});
it('blocks a redirect to a private Instagram image before sending the second request', async () => {
  const f = await fixture();
  roots.push(f.root);
  const server = createServer((_req, res) => {
    res.writeHead(302, { Location: 'https://www.instagram.com/ordinary-person/photo' });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/redirect`;
    f.post.sections[0].images[0] = {
      slotId: 's1-1',
      mode: 'download',
      engine: 'direct',
      query: 'publisher image',
      sourceId: 's1',
      imageUrl: url,
      originKind: 'publisher',
    };
    await atomicJson(join(f.job, 'post.json'), f.post);
    const before = await readFile(join(f.job, 'images/s1-1.png')),
      realFetch = globalThis.fetch;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input) !== url) throw Error('disallowed second request');
      return realFetch(input, init);
    });
    await expect(collectImages(f.job, f.config, 's1-1')).rejects.toThrow(/image_source_disallowed/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readFile(join(f.job, 'images/s1-1.png'))).toEqual(before);
  } finally {
    await new Promise<void>((r, reject) => server.close((e) => (e ? reject(e) : r())));
  }
});
it('refuses private source capture before connecting to the logged-in browser', async () => {
  const f = await fixture();
  roots.push(f.root);
  f.post.sections[0].images[0] = {
    slotId: 's1-1',
    mode: 'capture',
    sourceId: 's1',
    url: 'https://www.instagram.com/ordinary-person/photo',
    selector: 'main',
    requiredLabels: ['photo'],
    originKind: 'publisher',
  };
  await atomicJson(join(f.job, 'post.json'), f.post);
  const connect = vi.spyOn(chromium, 'connectOverCDP').mockRejectedValue(Error('must not connect'));
  await expect(captureImages(f.job, f.config, 's1-1')).rejects.toThrow(/image_source_disallowed/);
  expect(connect).not.toHaveBeenCalled();
});
it('does not reuse an old unverified cached capture for a new mutable draft', async () => {
  const f = await fixture();
  roots.push(f.root);
  const plan = {
    slotId: 's1-1',
    mode: 'capture' as const,
    sourceId: 's1',
    url: 'https://unclassified.example/blog/photo',
    selector: 'main',
    requiredLabels: ['photo'],
  };
  f.post.sections[0].images[0] = plan;
  f.assets[0] = {
    ...f.assets[0],
    kind: 'capture',
    sourceUrl: plan.url,
    originalUrl: null,
    selector: 'main',
    acquisitionFingerprint: imagePlanFingerprint('sec1', plan, f.research),
  };
  await atomicJson(join(f.job, 'post.json'), f.post);
  await atomicJson(join(f.job, 'assets.json'), {
    schemaVersion: 1,
    planFingerprint: fingerprint({ request: f.request, post: f.post }),
    assets: f.assets,
  });
  await atomicJson(join(f.job, 'receipts/attempt-s1-1.json'), { status: 'success' });
  await expect(
    validateAssets(f.job, f.request, f.post, { allowHistoricalSources: true }),
  ).resolves.toHaveLength(12);
  const connect = vi.spyOn(chromium, 'connectOverCDP').mockRejectedValue(Error('must not connect'));
  await expect(captureImages(f.job, f.config, 's1-1')).rejects.toThrow(/image_origin_unverified/);
  await expect(validateAssets(f.job, f.request, f.post)).rejects.toThrow(/image_origin_unverified/);
  expect(connect).not.toHaveBeenCalled();
});
