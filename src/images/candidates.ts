import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp, { type OverlayOptions } from 'sharp';
import type { Asset, AssetManifest, Config, ImagePlan, Post } from '../domain/types.js';
import {
  acquireLock,
  atomicJson,
  fingerprint,
  optionalJson,
  readJson,
  safeFile,
  sha256,
} from '../state/files.js';
import { assertMutable, readJob } from '../state/jobs.js';
import { readContent } from '../editorial/bundle.js';
import { plannedImages, validatePost } from '../editorial/post.js';
import { putAsset } from './assets.js';
import { imagePlanFingerprint } from './plan.js';
import { analyzeCandidateImage, visualHashDistance } from './candidateQuality.js';
import { assertAllowedImageOrigin, assertAllowedImageSource } from './sourcePolicy.js';
import policy from '../../config/image-source-policy.json' with { type: 'json' };
import {
  collectorArgs,
  runProcess,
  AUTH_WAIT_MS,
  COLLECTOR_TIMEOUT_MS,
} from './collectorProcess.js';
import { savedImages } from './collectorRows.js';

export interface SearchQuery {
  engine: 'google' | 'naver';
  query: string;
}
interface Review {
  slot: string;
  sourceId: string;
  reviewer: string;
  originKind: 'publisher' | 'official';
  originUrl: string;
  note: string;
  reviewedAt: string;
  acquisitionFingerprint: string;
  distinctScene: boolean;
  fingerprint: string;
}
export interface ImageCandidate {
  candidateId: string;
  engine: 'google' | 'naver';
  queries: string[];
  sourceUrl: string;
  imageUrl: string;
  originalUrl: string | null;
  downloadKind: 'original' | 'thumbnail';
  relativePath: string;
  sha256: string;
  pixelHash: string;
  visualHash: string;
  width: number;
  height: number;
  flags: string[];
  title: string;
  collectedAt: string;
  similarTo: string[];
  review?: Review;
}
interface QueryRecord extends SearchQuery {
  key: string;
  runRoot: string;
  finishedAt: string;
  status: 'complete' | 'failed';
  error?: string;
}
export interface CandidatePool {
  schemaVersion: 1;
  candidates: ImageCandidate[];
  queries: QueryRecord[];
  rejections: { query: string; sourceUrl: string; reason: string }[];
  contactSheet: string;
}
const poolPath = 'receipts/image-candidates.json';
const sheetPath = 'receipts/image-candidates.jpg';
const empty = (): CandidatePool => ({
  schemaVersion: 1,
  candidates: [],
  queries: [],
  rejections: [],
  contactSheet: sheetPath,
});
async function readPool(job: string): Promise<CandidatePool> {
  const pool = (await optionalJson<CandidatePool>(await safeFile(job, poolPath))) ?? empty();
  if (
    pool.schemaVersion !== 1 ||
    !Array.isArray(pool.candidates) ||
    !Array.isArray(pool.queries) ||
    !Array.isArray(pool.rejections)
  )
    throw Error('candidate_pool_invalid');
  return pool;
}
const cleanQuery = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ');
const queryKey = (q: SearchQuery) => fingerprint({ ...q, limit: 5, seconds: 35, policy });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function writePool(job: string, pool: CandidatePool) {
  await atomicJson(await safeFile(job, poolPath), pool);
}
async function contactSheet(job: string, pool: CandidatePool) {
  // Keep each preview bounded; the complete machine-readable list remains available.
  const rows = pool.candidates.slice(-60),
    cols = 4,
    w = 240,
    h = 240,
    layers: OverlayOptions[] = [];
  for (const [i, row] of rows.entries()) {
    let thumbnail: Buffer;
    try {
      thumbnail = await sharp(await safeFile(job, row.relativePath))
        .resize({ width: w - 10, height: h - 48, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      continue;
    }
    const meta = await sharp(thumbnail).metadata(),
      x = (i % cols) * w,
      y = Math.floor(i / cols) * h;
    layers.push({ input: thumbnail, left: x + Math.floor((w - meta.width!) / 2), top: y });
    const label = `${row.candidateId} ${row.width}x${row.height}${row.flags.length ? ' !' : ''}`;
    layers.push({
      input: Buffer.from(
        `<svg width="240" height="40"><rect width="240" height="40" fill="white"/><text x="4" y="24" font-size="12">${label}</text></svg>`,
      ),
      left: x,
      top: y + h - 42,
    });
  }
  const target = await safeFile(job, sheetPath);
  await mkdir(dirname(target), { recursive: true });
  await sharp({
    create: {
      width: w * cols,
      height: Math.max(h, Math.ceil(rows.length / cols) * h),
      channels: 3,
      background: '#eeeeee',
    },
  })
    .composite(layers)
    .jpeg({ quality: 88 })
    .toFile(target);
}
export async function listImageCandidates(job: string): Promise<CandidatePool> {
  await readJob(job);
  return readPool(job);
}
export async function searchImageCandidates(
  job: string,
  config: Config,
  queries: SearchQuery[],
  options: { run?: typeof runProcess; maxQueries?: number; refresh?: boolean } = {},
) {
  const max = options.maxQueries ?? 3;
  if (!Number.isInteger(max) || max < 1 || max > 3) throw Error('image_query_batch_limit');
  const normalized = queries.map((q) => ({ ...q, query: cleanQuery(q.query) }));
  if (
    !normalized.length ||
    normalized.some((q) => !q.query || !['google', 'naver'].includes(q.engine))
  )
    throw Error('image_query_required');
  const unlock = await acquireLock(await safeFile(job, 'job.lock'));
  try {
    await assertMutable(job);
    await readJob(job);
    const pool = await readPool(job),
      unique = [...new Map(normalized.map((q) => [queryKey(q), q])).values()];
    const pending = unique.filter(
      (q) =>
        options.refresh ||
        !pool.queries.some((r) => r.key === queryKey(q) && r.status === 'complete'),
    );
    let completed = 0;
    for (const q of pending.slice(0, max)) {
      const record: QueryRecord = {
        ...q,
        key: queryKey(q),
        runRoot: `receipts/image-search-${randomUUID()}`,
        finishedAt: '',
        status: 'failed',
      };
      const outputRoot = await safeFile(job, record.runRoot);
      await mkdir(outputRoot, { recursive: true });
      try {
        if (
          q.engine === 'google' &&
          new URL(config.googleCdpEndpoint).port === new URL(config.cdpEndpoint).port
        )
          throw Error('cdp_port_collision');
        const result = await (options.run ?? runProcess)(
          config.pythonPath,
          collectorArgs(q.engine, q.query, outputRoot, config.googleCdpEndpoint),
          config.root,
          COLLECTOR_TIMEOUT_MS,
          { authWaitMs: q.engine === 'google' ? AUTH_WAIT_MS : 0 },
        );
        await writeFile(join(outputRoot, 'collector.log'), result.output, 'utf8');
        let savedRows = 0;
        for (const dir of await readdir(outputRoot, { withFileTypes: true })) {
          if (!dir.isDirectory()) continue;
          const runRoot = await safeFile(outputRoot, dir.name);
          let data: unknown;
          try {
            data = await readJson(await safeFile(runRoot, 'run.json'));
          } catch {
            continue;
          }
          for (const row of savedImages(data)) {
            savedRows++;
            try {
              const imageUrl = String(
                row.downloaded_url ?? row.original_url ?? row.thumbnail_url ?? '',
              );
              if (!row.source_url) throw Error('image_source_missing');
              assertAllowedImageSource(row.source_url, imageUrl);
              if (q.engine === 'google' && row.download_kind !== 'original')
                throw Error('candidate_original_required');
              const bytes = await readFile(await safeFile(runRoot, row.saved_path)),
                analysis = await analyzeCandidateImage(bytes);
              const prior = pool.candidates.find(
                (r) => r.pixelHash === analysis.pixelHash && r.sourceUrl === row.source_url,
              );
              if (prior) {
                if (!prior.queries.includes(q.query)) prior.queries.push(q.query);
                continue;
              }
              const samePhoto = pool.candidates.find((r) => r.pixelHash === analysis.pixelHash);
              const candidateId =
                'img-' +
                fingerprint({ pixelHash: analysis.pixelHash, sourceUrl: row.source_url }).slice(
                  0,
                  16,
                );
              const relativePath =
                  samePhoto?.relativePath ?? `receipts/image-candidate-files/${candidateId}.png`,
                target = await safeFile(job, relativePath);
              if (!samePhoto) {
                await mkdir(dirname(target), { recursive: true });
                await writeFile(target, analysis.bytes);
              } else analysis.flags.push('same_photo_other_source');
              const similarTo = pool.candidates
                .filter((r) => visualHashDistance(r.visualHash, analysis.visualHash) <= 8)
                .map((r) => r.candidateId);
              if (similarTo.length) analysis.flags.push('similar_image');
              pool.candidates.push({
                candidateId,
                engine: q.engine,
                queries: [q.query],
                sourceUrl: row.source_url,
                imageUrl,
                originalUrl: row.download_kind === 'original' ? imageUrl : null,
                downloadKind: row.download_kind === 'original' ? 'original' : 'thumbnail',
                relativePath,
                sha256: analysis.sha256,
                pixelHash: analysis.pixelHash,
                visualHash: analysis.visualHash,
                width: analysis.width,
                height: analysis.height,
                flags: analysis.flags,
                title: String(row.title ?? ''),
                collectedAt: new Date().toISOString(),
                similarTo,
              });
            } catch (e) {
              pool.rejections.push({
                query: q.query,
                sourceUrl: String(row.source_url ?? ''),
                reason: message(e),
              });
            }
          }
        }
        if (!savedRows && result.code !== 0)
          throw Error(
            'image_collection_failed:exit_' + result.code + ':' + result.output.slice(-300),
          );
        // A bounded partial run is a completed review round, not a request to keep fetching20.
        record.status = 'complete';
        completed++;
        if (result.code !== 0) record.error = 'partial_round:' + result.output.slice(-300);
      } catch (e) {
        record.error = message(e);
        throw e;
      } finally {
        record.finishedAt = new Date().toISOString();
        pool.queries.push(record);
        await writePool(job, pool);
        await contactSheet(job, pool);
      }
    }
    await writePool(job, pool);
    await contactSheet(job, pool);
    return {
      status: 'image_candidates_ready' as const,
      candidateCount: pool.candidates.length,
      uniqueImageCount: new Set(pool.candidates.map((c) => c.pixelHash)).size,
      searchedQueries: completed,
      remainingQueries: Math.max(0, pending.length - completed),
      contactSheet: sheetPath,
      candidateList: poolPath,
    };
  } finally {
    await unlock();
  }
}
export interface SelectCandidateOptions {
  slot: string;
  candidateId: string;
  sourceId: string;
  reviewer: string;
  originKind: 'publisher' | 'official' | 'personal' | 'unknown';
  originUrl: string;
  note: string;
  distinctScene?: boolean;
}
function reviewFingerprint(candidate: ImageCandidate, review: Omit<Review, 'fingerprint'>): string {
  return fingerprint({
    candidateId: candidate.candidateId,
    sha256: candidate.sha256,
    sourceUrl: candidate.sourceUrl,
    imageUrl: candidate.imageUrl,
    review,
  });
}
async function checkedBytes(job: string, candidate: ImageCandidate) {
  const bytes = await readFile(await safeFile(job, candidate.relativePath));
  if (sha256(bytes) !== candidate.sha256) throw Error('candidate_bytes_changed');
  const analysis = await analyzeCandidateImage(bytes);
  if (
    analysis.width !== candidate.width ||
    analysis.height !== candidate.height ||
    analysis.pixelHash !== candidate.pixelHash
  )
    throw Error('candidate_bytes_changed');
  assertAllowedImageSource(candidate.sourceUrl, candidate.imageUrl);
  return analysis;
}
export async function selectImageCandidate(job: string, selection: SelectCandidateOptions) {
  if (!selection.reviewer?.trim() || !selection.note?.trim())
    throw Error('image_candidate_review_required');
  assertAllowedImageOrigin(selection.originKind, selection.originUrl);
  const unlock = await acquireLock(await safeFile(job, 'job.lock'));
  try {
    await assertMutable(job);
    const content = await readContent(job),
      pool = await readPool(job),
      candidate = pool.candidates.find((c) => c.candidateId === selection.candidateId);
    if (!candidate) throw Error('image_candidate_not_found');
    const analysis = await checkedBytes(job, candidate);
    const source = content.research.sources.find((s) => s.sourceId === selection.sourceId);
    if (!source || source.url !== candidate.sourceUrl) throw Error('candidate_source_mismatch');
    const item = plannedImages(content.post).find((x) => x.plan.slotId === selection.slot);
    if (!item || item.plan.mode !== 'download') throw Error('image_slot_not_found');
    const old = await optionalJson<AssetManifest>(await safeFile(job, 'assets.json'));
    for (const asset of old?.assets ?? []) {
      if (asset.slotId === selection.slot) continue;
      const current = plannedImages(content.post).find((p) => p.plan.slotId === asset.slotId);
      if (
        !current ||
        asset.acquisitionFingerprint !==
          imagePlanFingerprint(current.sectionId, current.plan, content.research)
      )
        continue;
      if (asset.candidateId === candidate.candidateId || asset.sha256 === analysis.sha256)
        throw Error('duplicate_candidate');
      const otherBytes = await readFile(await safeFile(job, asset.relativePath));
      if (sha256(otherBytes) !== asset.sha256)
        throw Error('existing_asset_bytes_changed:' + asset.slotId);
      const other = await analyzeCandidateImage(otherBytes);
      if (other.pixelHash === candidate.pixelHash) throw Error('duplicate_candidate');
      if (
        visualHashDistance(other.visualHash, candidate.visualHash) <= 8 &&
        !selection.distinctScene
      )
        throw Error('similar_candidate_requires_distinct_scene_review');
    }
    const plan: ImagePlan = {
      slotId: selection.slot,
      mode: 'download',
      engine: 'direct',
      query: candidate.queries[0],
      sourceId: source.sourceId,
      imageUrl: candidate.imageUrl,
      candidateId: candidate.candidateId,
      originKind: selection.originKind as 'publisher' | 'official',
      originUrl: selection.originUrl,
    };
    const post: Post = structuredClone(content.post),
      section = post.sections.find((s) => s.sectionId === item.sectionId)!;
    section.images[section.images.findIndex((p) => p.slotId === selection.slot)] = plan;
    const errors = validatePost(content.request, content.research, post);
    if (errors.length) throw Error('validation_failed:' + errors.join(','));
    const acquisitionFingerprint = imagePlanFingerprint(item.sectionId, plan, content.research);
    const reviewWithoutHash: Omit<Review, 'fingerprint'> = {
      slot: selection.slot,
      sourceId: source.sourceId,
      reviewer: selection.reviewer.trim(),
      originKind: selection.originKind as 'publisher' | 'official',
      originUrl: selection.originUrl,
      note: selection.note.trim(),
      reviewedAt: new Date().toISOString(),
      acquisitionFingerprint,
      distinctScene: selection.distinctScene ?? false,
    };
    const review: Review = {
      ...reviewWithoutHash,
      fingerprint: reviewFingerprint(candidate, reviewWithoutHash),
    };
    candidate.review = review;
    const relativePath = `images/${selection.slot}.png`;
    const asset: Asset = {
      assetId: selection.slot,
      slotId: selection.slot,
      sectionId: item.sectionId,
      kind: 'download',
      relativePath,
      sha256: analysis.sha256,
      width: analysis.width,
      height: analysis.height,
      sourceUrl: source.url,
      originalUrl: candidate.originalUrl,
      requestedUrl: candidate.imageUrl,
      acquisitionFingerprint,
      acquiredAt: new Date().toISOString(),
      caption: '',
      query: plan.query,
      engine: 'direct',
      candidateId: candidate.candidateId,
      candidateReviewFingerprint: review.fingerprint,
    };
    await atomicJson(await safeFile(job, 'post.json'), post);
    await atomicJson(await safeFile(job, `receipts/attempt-${selection.slot}.json`), {
      status: 'running',
      slotId: selection.slot,
      startedAt: new Date().toISOString(),
    });
    try {
      await writeFile(await safeFile(job, relativePath), analysis.bytes);
      await writePool(job, pool);
      await putAsset(job, content.request, post, asset);
      await atomicJson(await safeFile(job, `receipts/asset-${selection.slot}.json`), asset);
      await atomicJson(await safeFile(job, `receipts/attempt-${selection.slot}.json`), {
        status: 'success',
        slotId: selection.slot,
        sha256: asset.sha256,
        completedAt: new Date().toISOString(),
        candidateId: candidate.candidateId,
      });
    } catch (e) {
      await atomicJson(await safeFile(job, `receipts/attempt-${selection.slot}.json`), {
        status: 'failed',
        slotId: selection.slot,
        error: message(e),
      });
      throw e;
    }
    return {
      status: 'image_selected' as const,
      slotId: selection.slot,
      candidateId: candidate.candidateId,
    };
  } finally {
    await unlock();
  }
}
export async function validateCandidateAsset(job: string, plan: ImagePlan, asset: Asset) {
  if (plan.mode !== 'download' || plan.engine !== 'direct' || !plan.candidateId) return;
  const pool = await readPool(job),
    candidate = pool.candidates.find((c) => c.candidateId === plan.candidateId),
    review = candidate?.review;
  if (!candidate || !review) throw Error('image_candidate_review_required');
  const { fingerprint: stored, ...withoutHash } = review;
  assertAllowedImageOrigin(review.originKind, review.originUrl);
  assertAllowedImageSource(candidate.sourceUrl, candidate.imageUrl);
  if (
    stored !== reviewFingerprint(candidate, withoutHash) ||
    stored !== asset.candidateReviewFingerprint ||
    asset.candidateId !== candidate.candidateId ||
    asset.sha256 !== candidate.sha256 ||
    asset.originalUrl !== candidate.originalUrl ||
    review.slot !== plan.slotId ||
    review.sourceId !== plan.sourceId ||
    review.acquisitionFingerprint !== asset.acquisitionFingerprint ||
    candidate.sourceUrl !== asset.sourceUrl ||
    candidate.imageUrl !== plan.imageUrl ||
    review.originKind !== plan.originKind ||
    review.originUrl !== plan.originUrl
  )
    throw Error('candidate_review_stale');
  await checkedBytes(job, candidate);
}
