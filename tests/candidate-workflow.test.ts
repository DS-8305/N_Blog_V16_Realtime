import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture } from './helpers.js';
import { atomicJson, fingerprint, readJson, sha256 } from '../src/state/files.js';
import { imagePlanFingerprint } from '../src/images/plan.js';
import { validateAssets } from '../src/images/assets.js';
import { collectImages } from '../src/images/collect.js';
import {
  searchImageCandidates,
  listImageCandidates,
  selectImageCandidate,
} from '../src/images/candidates.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function setup() {
  const f = await fixture();
  roots.push(f.root);
  return f;
}
async function picture(seed = 0) {
  return sharp(
    Buffer.from(
      `<svg width="800" height="900"><rect width="800" height="900" fill="${seed ? '#2299aa' : '#aa9944'}"/><circle cx="${200 + seed * 100}" cy="300" r="150" fill="black"/><path d="M100 700 L700 ${400 + seed * 100}" stroke="white" stroke-width="90"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}
function fakeCollector(bytes: Buffer, source = 'https://example.org/news') {
  let calls = 0;
  const captured: string[][] = [];
  const run = async (_exe: string, args: string[]) => {
    calls++;
    captured.push(args);
    const base = args[args.indexOf('--output-dir') + 1],
      folder = join(base, 'run-offline', 'photos');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'image_01.png'), bytes);
    await atomicJson(join(base, 'run-offline', 'run.json'), {
      jobs: {
        one: {
          folder: 'photos',
          records: [
            {
              status: 'saved',
              file_name: 'image_01.png',
              source_url: source,
              original_url: 'https://example.org/photo.png',
              downloaded_url: 'https://example.org/photo.png',
              download_kind: 'original',
              title: 'Verified publisher photo',
            },
          ],
        },
      },
    });
    return { code: 1, output: 'partial: saved an original' };
  };
  return {
    run,
    get calls() {
      return calls;
    },
    captured,
  };
}
it('collects a small pending round without assigning a first result to the manuscript', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture());
  const before = await readFile(join(f.job, 'assets.json'), 'utf8'),
    post = await readFile(join(f.job, 'post.json'), 'utf8');
  const result = await searchImageCandidates(
    f.job,
    f.config,
    [{ engine: 'google', query: '인물 가족사진' }],
    { run: runner.run },
  );
  expect(result.status).toBe('image_candidates_ready');
  expect(result.candidateCount).toBe(1);
  expect(runner.captured[0]).toEqual(
    expect.arrayContaining(['--limit', '5', '--keyword-timeout', '35', '--min-width', '400']),
  );
  expect(await readFile(join(f.job, 'assets.json'), 'utf8')).toBe(before);
  expect(await readFile(join(f.job, 'post.json'), 'utf8')).toBe(post);
  const pool = await listImageCandidates(f.job);
  expect(pool.candidates[0].review).toBeUndefined();
  expect((await readFile(join(f.job, pool.contactSheet))).length).toBeGreaterThan(0);
});
it('shares exact pixels across queries and reuses completed query rounds', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture());
  const queries = [
    { engine: 'google' as const, query: '인물' },
    { engine: 'google' as const, query: '인물 가족사진' },
  ];
  await searchImageCandidates(f.job, f.config, queries, { run: runner.run });
  await searchImageCandidates(f.job, f.config, queries, { run: runner.run });
  expect(runner.calls).toBe(2);
  const pool = await listImageCandidates(f.job);
  expect(pool.candidates).toHaveLength(1);
  expect(pool.candidates[0].queries).toEqual(expect.arrayContaining(['인물', '인물 가족사진']));
});
it('stops after three queries and searches only remaining queries on the next call', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture());
  const queries = Array.from({ length: 5 }, (_, i) => ({
    engine: 'google' as const,
    query: '장면 ' + i,
  }));
  const first = await searchImageCandidates(f.job, f.config, queries, { run: runner.run });
  expect(runner.calls).toBe(3);
  expect(first.remainingQueries).toBe(2);
  await searchImageCandidates(f.job, f.config, queries, { run: runner.run });
  expect(runner.calls).toBe(5);
});
it('imports a reviewed collected original without another network request and binds current source and plan', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture());
  await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물' }], {
    run: runner.run,
  });
  const pool = await listImageCandidates(f.job);
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('network must not be used'));
  await selectImageCandidate(f.job, {
    slot: 's1-1',
    candidateId: pool.candidates[0].candidateId,
    sourceId: 's1',
    reviewer: 'Codex',
    originKind: 'publisher',
    originUrl: 'https://example.org/news',
    note: 'Inspected actual person and scene, checked publisher origin.',
  });
  expect(fetch).not.toHaveBeenCalled();
  const post = await readJson<any>(join(f.job, 'post.json'));
  expect(post.sections[0].images[0].candidateId).toBe(pool.candidates[0].candidateId);
  const assets = await validateAssets(f.job, f.request, post);
  expect(assets.find((a) => a.slotId === 's1-1')?.width).toBe(800);
});
it.each(['personal', 'unknown'] as const)(
  'refuses %s origins even when a newspaper hosts a reprint',
  async (originKind) => {
    const f = await setup(),
      runner = fakeCollector(await picture());
    await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물' }], {
      run: runner.run,
    });
    const pool = await listImageCandidates(f.job),
      before = await readFile(join(f.job, 'post.json'), 'utf8');
    await expect(
      selectImageCandidate(f.job, {
        slot: 's1-1',
        candidateId: pool.candidates[0].candidateId,
        sourceId: 's1',
        reviewer: 'Codex',
        originKind,
        originUrl: 'https://example.org/news',
        note: 'Origin is not an established publisher or official source.',
      }),
    ).rejects.toThrow(/origin/);
    expect(await readFile(join(f.job, 'post.json'), 'utf8')).toBe(before);
  },
);
it('rejects corrupted cached bytes and preserves the existing slot', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture());
  await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물' }], {
    run: runner.run,
  });
  const pool = await listImageCandidates(f.job),
    candidate = pool.candidates[0];
  await writeFile(join(f.job, candidate.relativePath), 'corrupt');
  const before = await readFile(join(f.job, 'images/s1-1.png'));
  await expect(
    selectImageCandidate(f.job, {
      slot: 's1-1',
      candidateId: candidate.candidateId,
      sourceId: 's1',
      reviewer: 'Codex',
      originKind: 'publisher',
      originUrl: 'https://example.org/news',
      note: 'Reviewed.',
    }),
  ).rejects.toThrow(/candidate_bytes_changed/);
  expect(await readFile(join(f.job, 'images/s1-1.png'))).toEqual(before);
});
it('does not admit blocked personal-source downloads into the pending pool', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture(), 'https://www.instagram.com/ordinary-person/');
  const result = await searchImageCandidates(
    f.job,
    f.config,
    [{ engine: 'google', query: '인물' }],
    { run: runner.run },
  );
  expect(result.candidateCount).toBe(0);
  expect((await listImageCandidates(f.job)).rejections.some((r) => /source/.test(r.reason))).toBe(
    true,
  );
});
it('invalidates a selected asset when its recorded content review changes', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture());
  await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물' }], {
    run: runner.run,
  });
  const pool = await listImageCandidates(f.job),
    candidate = pool.candidates[0];
  await selectImageCandidate(f.job, {
    slot: 's1-1',
    candidateId: candidate.candidateId,
    sourceId: 's1',
    reviewer: 'Codex',
    originKind: 'publisher',
    originUrl: 'https://example.org/news',
    note: 'Reviewed actual image and source.',
  });
  const selected = await listImageCandidates(f.job);
  selected.candidates[0].review!.note = 'Unreviewed metadata edit';
  await atomicJson(join(f.job, 'receipts/image-candidates.json'), selected);
  const post = await readJson<any>(join(f.job, 'post.json'));
  await expect(validateAssets(f.job, f.request, post)).rejects.toThrow('candidate_review_stale');
});
it('prevents assigning the same reviewed photo to another slot', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture());
  await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물' }], {
    run: runner.run,
  });
  const pool = await listImageCandidates(f.job),
    options = {
      candidateId: pool.candidates[0].candidateId,
      sourceId: 's1',
      reviewer: 'Codex',
      originKind: 'publisher' as const,
      originUrl: 'https://example.org/news',
      note: 'Reviewed actual image and source.',
    };
  await selectImageCandidate(f.job, { ...options, slot: 's1-1' });
  await expect(selectImageCandidate(f.job, { ...options, slot: 's1-2' })).rejects.toThrow(
    'duplicate_candidate',
  );
});
it('keeps a later publisher source for identical pixels while sharing the cached file', async () => {
  const f = await setup(),
    bytes = await picture();
  await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물' }], {
    run: fakeCollector(bytes, 'https://unclassified.example/blog/photo').run,
  });
  await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물 언론' }], {
    run: fakeCollector(bytes).run,
  });
  const pool = await listImageCandidates(f.job);
  expect(pool.candidates).toHaveLength(2);
  expect(new Set(pool.candidates.map((c) => c.relativePath)).size).toBe(1);
  const publisher = pool.candidates.find((c) => c.sourceUrl === 'https://example.org/news')!;
  await selectImageCandidate(f.job, {
    slot: 's1-1',
    candidateId: publisher.candidateId,
    sourceId: 's1',
    reviewer: 'Codex',
    originKind: 'publisher',
    originUrl: publisher.sourceUrl,
    note: 'Verified publisher origin from the later result.',
  });
  const post = await readJson<any>(join(f.job, 'post.json'));
  expect(
    (await validateAssets(f.job, f.request, post)).find((a) => a.slotId === 's1-1')?.sourceUrl,
  ).toBe('https://example.org/news');
});
it('rejects the same decoded photo already assigned through a noncandidate RGB download', async () => {
  const f = await setup(),
    bytes = await picture(),
    rgb = await sharp(bytes).removeAlpha().png().toBuffer();
  const plan = {
    slotId: 's1-1',
    mode: 'download' as const,
    engine: 'direct' as const,
    query: 'publisher original',
    sourceId: 's1',
    imageUrl: 'https://example.org/photo.png',
    originKind: 'publisher' as const,
  };
  f.post.sections[0].images[0] = plan;
  f.assets[0] = {
    ...f.assets[0],
    engine: 'direct',
    query: plan.query,
    sourceUrl: 'https://example.org/news',
    originalUrl: plan.imageUrl,
    requestedUrl: plan.imageUrl,
    sha256: sha256(rgb),
    width: 800,
    height: 900,
    acquisitionFingerprint: imagePlanFingerprint('sec1', plan, f.research),
  };
  await writeFile(join(f.job, 'images/s1-1.png'), rgb);
  await atomicJson(join(f.job, 'post.json'), f.post);
  await atomicJson(join(f.job, 'assets.json'), {
    schemaVersion: 1,
    planFingerprint: fingerprint({ request: f.request, post: f.post }),
    assets: f.assets,
  });
  await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물 다른 검색' }], {
    run: fakeCollector(bytes).run,
  });
  const pool = await listImageCandidates(f.job);
  await expect(
    selectImageCandidate(f.job, {
      slot: 's1-2',
      candidateId: pool.candidates[0].candidateId,
      sourceId: 's1',
      reviewer: 'Codex',
      originKind: 'publisher',
      originUrl: 'https://example.org/news',
      note: 'Reviewed.',
    }),
  ).rejects.toThrow(/duplicate/);
});
it('restores a missing assigned image from the reviewed cache without fetching', async () => {
  const f = await setup(),
    runner = fakeCollector(await picture());
  await searchImageCandidates(f.job, f.config, [{ engine: 'google', query: '인물' }], {
    run: runner.run,
  });
  const pool = await listImageCandidates(f.job);
  await selectImageCandidate(f.job, {
    slot: 's1-1',
    candidateId: pool.candidates[0].candidateId,
    sourceId: 's1',
    reviewer: 'Codex',
    originKind: 'publisher',
    originUrl: 'https://example.org/news',
    note: 'Reviewed.',
  });
  const before = await readFile(join(f.job, 'images/s1-1.png'));
  await unlink(join(f.job, 'images/s1-1.png'));
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('no network'));
  await collectImages(f.job, f.config, 's1-1');
  expect(await readFile(join(f.job, 'images/s1-1.png'))).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
});
