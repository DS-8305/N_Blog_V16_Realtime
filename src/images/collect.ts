import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Config } from '../domain/types.js';
import { readContent } from '../editorial/bundle.js';
import { plannedImages } from '../editorial/post.js';
import { optionalJson, safeFile, sha256 } from '../state/files.js';
import { acquireSlots } from './acquire.js';
import {
  listImageCandidates,
  searchImageCandidates,
  validateCandidateAsset,
} from './candidates.js';
import { assertAllowedImageOrigin, assertAllowedImageSource } from './sourcePolicy.js';
export { disallowedImageDomains, isDisallowedImageSource } from './sourcePolicy.js';
export { savedImages } from './collectorRows.js';
export {
  AUTH_WAIT_MS,
  COLLECTOR_TIMEOUT_MS,
  collectorArgs,
  collectorKillAt,
  createCollectorWatch,
  debuggerAddress,
  noteCollectorOutput,
  runProcess,
} from './collectorProcess.js';

async function fetchImage(sourceUrl: string, imageUrl: string) {
  let target = imageUrl;
  for (let i = 0; i < 6; i++) {
    assertAllowedImageSource(sourceUrl, target);
    const response = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error('image_redirect_without_location');
      target = new URL(location, target).href;
      assertAllowedImageSource(sourceUrl, target);
      continue;
    }
    assertAllowedImageSource(sourceUrl, target, response.url || target);
    return response;
  }
  throw Error('image_redirect_limit');
}

export async function collectImages(job: string, config: Config, slot?: string) {
  const content = await readContent(job),
    plans = plannedImages(content.post).filter((p) => !slot || p.plan.slotId === slot);
  if (slot && !plans.length) throw Error('image_slot_not_found');
  for (const { plan } of plans) {
    if (plan.mode === 'download' && plan.engine === 'direct') {
      const source = content.research.sources.find((s) => s.sourceId === plan.sourceId);
      if (!source) throw Error('image_source_missing');
      assertAllowedImageSource(source.url, plan.imageUrl);
      assertAllowedImageOrigin(plan.originKind ?? 'unknown', plan.originUrl ?? source.url);
    }
  }
  await acquireSlots(
    job,
    'download',
    async ({ sectionId, plan }, used) => {
      if (plan.mode !== 'download' || plan.engine !== 'direct')
        throw Error('image_candidate_selection_required');
      const source = content.research.sources.find((s) => s.sourceId === plan.sourceId)!;
      if (plan.candidateId) {
        const prior = await optionalJson<import('../domain/types.js').Asset>(
          await safeFile(job, 'receipts/asset-' + plan.slotId + '.json'),
        );
        if (!prior) throw Error('image_candidate_review_required');
        await validateCandidateAsset(job, plan, prior);
        const candidate = (await listImageCandidates(job)).candidates.find(
          (c) => c.candidateId === plan.candidateId,
        );
        if (!candidate) throw Error('image_candidate_not_found');
        const bytes = await readFile(await safeFile(job, candidate.relativePath));
        if (sha256(bytes) !== prior.sha256 || used.has(prior.sha256))
          throw Error('candidate_bytes_changed');
        await writeFile(await safeFile(job, prior.relativePath), bytes);
        return prior;
      }
      const response = await fetchImage(source.url, plan.imageUrl),
        mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (
        !response.ok ||
        (!mediaType?.startsWith('image/') &&
          mediaType !== 'application/octet-stream' &&
          mediaType !== 'binary/octet-stream')
      )
        throw Error('image_response_invalid:' + response.status);
      const raw = Buffer.from(await response.arrayBuffer());
      if (raw.length > 30 * 1024 * 1024) throw Error('image_too_large');
      const bytes = await sharp(raw).rotate().png().toBuffer(),
        meta = await sharp(bytes).metadata();
      if (!meta.width || !meta.height) throw Error('image_decode_failed');
      if (used.has(sha256(bytes))) throw Error('duplicate_image:' + plan.slotId);
      const relativePath = 'images/' + plan.slotId + '.png';
      await writeFile(await safeFile(job, relativePath), bytes);
      return {
        assetId: plan.slotId,
        slotId: plan.slotId,
        sectionId,
        kind: 'download' as const,
        relativePath,
        sha256: sha256(bytes),
        width: meta.width,
        height: meta.height,
        sourceUrl: source.url,
        originalUrl: response.url || plan.imageUrl,
        requestedUrl: plan.imageUrl,
        acquiredAt: new Date().toISOString(),
        caption: plan.caption ?? '',
        query: plan.query,
        engine: plan.engine,
      };
    },
    slot,
    (plan) => plan.mode === 'download' && plan.engine === 'direct',
  );
  const manifest = await optionalJson<import('../domain/types.js').AssetManifest>(
    await safeFile(job, 'assets.json'),
  );
  const queries = plans
    .filter(
      ({ sectionId, plan }) =>
        plan.mode === 'download' &&
        plan.engine !== 'direct' &&
        !manifest?.assets.some(
          (a) =>
            a.slotId === plan.slotId &&
            a.acquisitionFingerprint === importFingerprint(sectionId, plan, content.research),
        ),
    )
    .map(({ plan }) => ({
      engine: (plan as { engine: 'google' | 'naver' }).engine,
      query: (plan as { query: string }).query,
    }));
  if (queries.length) return searchImageCandidates(job, config, queries);
  return { status: 'images_collected' as const, jobPath: job };
}
import { imagePlanFingerprint as importFingerprint } from './plan.js';
