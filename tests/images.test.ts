import { it, expect, afterEach } from 'vitest';
import { rm, copyFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fixture } from './helpers.js';
import { atomicJson } from '../src/state/files.js';
import { validateAssets } from '../src/images/assets.js';
import { savedImages, collectImages, isDisallowedImageSource } from '../src/images/collect.js';
import { validatePost } from '../src/editorial/post.js';
import { assertRegionReady } from '../src/capture/readiness.js';
import { acquireSlots } from '../src/images/acquire.js';
const roots: string[] = [];
it.each([
  ['url', 'https://example.org/new-page'],
  ['selector', 'main article'],
  ['frameSelector', 'iframe.new-frame'],
  ['requiredLabels', ['새 발표']],
  ['sourceId', 's2'],
])(
  'rejects a stale capture when %s changes and another slot is refreshed',
  async (field, value) => {
    const f = await fixture();
    roots.push(f.root);
    f.research.sources.push({
      ...f.research.sources[0],
      sourceId: 's2',
      url: 'https://example.org/second-source',
    });
    await atomicJson(join(f.job, 'research.json'), f.research);
    const capture = {
      slotId: 's1-1',
      mode: 'capture' as const,
      originKind: 'publisher' as const,
      sourceId: 's1',
      url: 'https://example.org/old-page',
      selector: 'article',
      requiredLabels: ['발표'],
    };
    f.post.sections[0].images[0] = capture;
    await atomicJson(join(f.job, 'post.json'), f.post);
    await acquireSlots(
      f.job,
      'capture',
      async () => ({
        ...f.assets[0],
        kind: 'capture',
        sourceUrl: capture.url,
        originalUrl: null,
        selector: capture.selector,
      }),
      's1-1',
    );
    await validateAssets(f.job, f.request, f.post);
    f.post.sections[0].images[0] = { ...capture, [field]: value };
    await atomicJson(join(f.job, 'post.json'), f.post);
    await acquireSlots(f.job, 'download', async () => f.assets[1], 's1-2');
    await expect(validateAssets(f.job, f.request, f.post)).rejects.toThrow(
      'asset_plan_changed:s1-1',
    );
  },
);
it('invalidates a capture when its referenced source URL changes', async () => {
  const f = await fixture();
  roots.push(f.root);
  const capture = {
    slotId: 's1-1',
    mode: 'capture' as const,
    originKind: 'publisher' as const,
    sourceId: 's1',
    url: 'https://example.org/news',
    selector: 'article',
    requiredLabels: ['발표'],
  };
  f.post.sections[0].images[0] = capture;
  await atomicJson(join(f.job, 'post.json'), f.post);
  await acquireSlots(
    f.job,
    'capture',
    async () => ({
      ...f.assets[0],
      kind: 'capture',
      sourceUrl: capture.url,
      originalUrl: null,
      selector: capture.selector,
    }),
    's1-1',
  );
  f.research.sources[0].url = 'https://example.org/new-source';
  await atomicJson(join(f.job, 'research.json'), f.research);
  await expect(validateAssets(f.job, f.request, f.post)).rejects.toThrow('asset_plan_changed:s1-1');
});
it('reuses an unchanged acquired slot after only manuscript text changes', async () => {
  const f = await fixture();
  roots.push(f.root);
  await acquireSlots(f.job, 'download', async () => f.assets[0], 's1-1');
  f.post.intro[0] = f.post.intro[0].replace('가', '나');
  await atomicJson(join(f.job, 'post.json'), f.post);
  let calls = 0;
  await acquireSlots(
    f.job,
    'download',
    async () => {
      calls++;
      return f.assets[0];
    },
    's1-1',
  );
  expect(calls).toBe(0);
});
it('rejects an old direct image after its URL changes and another slot is collected', async () => {
  const f = await fixture();
  roots.push(f.root);
  const bytes = await Promise.all(
    f.assets.slice(0, 2).map((a) => readFile(join(f.job, a.relativePath))),
  );
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'image/png');
    res.end(bytes[req.url === '/second' ? 1 : 0]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const first = {
      slotId: 's1-1',
      mode: 'download',
      engine: 'direct',
      query: 'first photo',
      originKind: 'publisher',
      sourceId: 's1',
      imageUrl: base + '/first',
    } as const;
    f.post.sections[0].images[0] = first;
    await atomicJson(join(f.job, 'post.json'), f.post);
    await collectImages(f.job, f.config, 's1-1');
    f.post.sections[0].images[0] = { ...first, imageUrl: base + '/changed' };
    f.post.sections[0].images[1] = {
      ...first,
      slotId: 's1-2',
      imageUrl: base + '/second',
      query: 'second photo',
    };
    await atomicJson(join(f.job, 'post.json'), f.post);
    await collectImages(f.job, f.config, 's1-2');
    await expect(validateAssets(f.job, f.request, f.post)).rejects.toThrow(
      'asset_plan_changed:s1-1',
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
it('downloads an observed source image with provenance and rejects an HTML response', async () => {
  const f = await fixture();
  roots.push(f.root);
  const bytes = await readFile(join(f.job, f.assets[0].relativePath));
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/photo' ? 'image/png' : 'text/html');
    res.end(req.url === '/photo' ? bytes : '<html>not an image</html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    f.post.sections[0].images[0] = {
      slotId: 's1-1',
      mode: 'download',
      engine: 'direct',
      query: 'official gallery photo',
      originKind: 'publisher',
      sourceId: 's1',
      imageUrl: base + '/photo',
    } as any;
    expect(validatePost(f.request, f.research, f.post)).toEqual([]);
    const invalid = structuredClone(f.post);
    delete (invalid.sections[0].images[0] as any).sourceId;
    expect(validatePost(f.request, f.research, invalid)).toContain('image_search:s1-1');
    await atomicJson(join(f.job, 'post.json'), f.post);
    await collectImages(f.job, f.config, 's1-1');
    const manifest = JSON.parse(await readFile(join(f.job, 'assets.json'), 'utf8'));
    expect(manifest.assets.find((a: any) => a.slotId === 's1-1')).toMatchObject({
      engine: 'direct',
      sourceUrl: 'https://example.org/news',
      originalUrl: base + '/photo',
      width: 40,
      height: 30,
    });
    f.post.sections[0].images[1] = {
      ...f.post.sections[0].images[0],
      slotId: 's1-2',
      imageUrl: base + '/html',
    } as any;
    await atomicJson(join(f.job, 'post.json'), f.post);
    await expect(collectImages(f.job, f.config, 's1-2')).rejects.toThrow('image_response_invalid');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
it('accepts a decodable official image served as an octet stream', async () => {
  const f = await fixture();
  roots.push(f.root);
  const bytes = await readFile(join(f.job, f.assets[0].relativePath));
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'binary/octet-stream');
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    f.post.sections[0].images[0] = {
      slotId: 's1-1',
      mode: 'download',
      engine: 'direct',
      query: 'official portrait',
      originKind: 'publisher',
      sourceId: 's1',
      imageUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/portrait`,
    };
    await atomicJson(join(f.job, 'post.json'), f.post);
    await collectImages(f.job, f.config, 's1-1');
    const manifest = JSON.parse(await readFile(join(f.job, 'assets.json'), 'utf8'));
    expect(manifest.assets.find((a: any) => a.slotId === 's1-1')).toMatchObject({
      width: 40,
      height: 30,
      engine: 'direct',
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('requires all slots and rejects repeated image bytes across different sections', async () => {
  const f = await fixture();
  roots.push(f.root);
  await copyFile(join(f.job, f.assets[0].relativePath), join(f.job, f.assets[4].relativePath));
  f.assets[4] = {
    ...f.assets[4],
    sha256: f.assets[0].sha256,
    width: f.assets[0].width,
    height: f.assets[0].height,
  };
  await atomicJson(join(f.job, 'assets.json'), {
    schemaVersion: 1,
    planFingerprint: (await import('../src/state/files.js')).fingerprint({
      request: f.request,
      post: f.post,
    }),
    assets: f.assets,
  });
  await expect(validateAssets(f.job, f.request, f.post)).rejects.toThrow('duplicate_image');
});
it('finds a missing image slot rather than accepting a matching overall count', async () => {
  const f = await fixture();
  roots.push(f.root);
  f.assets[0].slotId = 'unknown';
  await atomicJson(join(f.job, 'assets.json'), {
    schemaVersion: 1,
    planFingerprint: (await import('../src/state/files.js')).fingerprint({
      request: f.request,
      post: f.post,
    }),
    assets: f.assets,
  });
  await expect(validateAssets(f.job, f.request, f.post)).rejects.toThrow(/asset_slot/);
});
it('extracts only successful collector records with local filenames', () => {
  expect(
    savedImages({
      jobs: {
        one: {
          folder: 'google/topic',
          records: [
            { status: 'saved', file_name: 'image_0001.png', source_url: 'https://example.org' },
            { status: 'failed', file_name: 'bad.png' },
            { status: 'saved' },
          ],
        },
      },
    }),
  ).toEqual([
    {
      status: 'saved',
      file_name: 'image_0001.png',
      source_url: 'https://example.org',
      saved_path: 'google/topic/image_0001.png',
    },
  ]);
});
it.each(['loading', 'occluded', 'clipped', 'unloadedImages'])(
  'blocks capture when %s is present',
  (key) => {
    const state = {
      visible: true,
      loading: false,
      occluded: false,
      clipped: false,
      unloadedImages: 0,
      text: '발표 내용',
      width: 640,
      height: 400,
      [key]: key === 'unloadedImages' ? 1 : true,
    };
    expect(() => assertRegionReady(state, ['발표'])).toThrow();
  },
);
it('identifies disallowed image sources from personal blogs and communities', () => {
  expect(isDisallowedImageSource('https://blog.naver.com/someone/123')).toBe(true);
  expect(isDisallowedImageSource('https://m.blog.naver.com/someone/123')).toBe(true);
  expect(isDisallowedImageSource('https://cafe.naver.com/someone/123')).toBe(true);
  expect(isDisallowedImageSource('https://sub.tistory.com/entry/123')).toBe(true);
  expect(isDisallowedImageSource('https://gall.dcinside.com/board/view/123')).toBe(true);
  expect(isDisallowedImageSource('https://namu.wiki/w/something')).toBe(true);
  expect(isDisallowedImageSource(null)).toBe(true);
  expect(isDisallowedImageSource('')).toBe(true);
  expect(isDisallowedImageSource('invalid-url')).toBe(true);

  expect(isDisallowedImageSource('https://news.naver.com/article/001/0001')).toBe(false);
  expect(isDisallowedImageSource('https://www.chosun.com/entertain/2026/10/29/123')).toBe(false);
  expect(isDisallowedImageSource('https://img.ytn.co.kr/photo.jpg')).toBe(false);
});
