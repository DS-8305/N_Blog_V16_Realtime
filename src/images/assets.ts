import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Asset, AssetManifest, JobRequest, Post, Research } from '../domain/types.js';
import {
  readJson,
  safeFile,
  sha256,
  fingerprint,
  optionalJson,
  atomicJson,
} from '../state/files.js';
import { plannedImages } from '../editorial/post.js';
import { dateValue, webUrl } from '../domain/validation.js';
import { imagePlanFingerprint } from './plan.js';
export async function validateAssets(
  job: string,
  request: JobRequest,
  post: Post,
): Promise<Asset[]> {
  const manifest = await readJson<AssetManifest>(await safeFile(job, 'assets.json'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets))
    throw Error('asset_manifest_invalid');
  if (manifest.planFingerprint !== fingerprint({ request, post })) throw Error('asset_plan_stale');
  const plans = plannedImages(post);
  const research = await readJson<Research>(await safeFile(job, 'research.json'));
  if (plans.length !== manifest.assets.length) throw Error('asset_slot_count');
  const ids = new Set<string>(),
    hashes = new Set<string>(),
    ordered: Asset[] = [];
  for (const { sectionId, plan } of plans) {
    const matches = manifest.assets.filter((a) => a.slotId === plan.slotId);
    if (matches.length !== 1) throw Error('asset_slot:' + plan.slotId);
    const a = matches[0];
    if (
      !a.assetId ||
      ids.has(a.assetId) ||
      a.sectionId !== sectionId ||
      (a.caption ?? '') !== (plan.caption ?? '') ||
      a.kind !== plan.mode ||
      !webUrl(a.sourceUrl) ||
      (a.originalUrl !== null && !webUrl(a.originalUrl)) ||
      !dateValue(a.acquiredAt)
    )
      throw Error('asset_metadata:' + plan.slotId);
    ids.add(a.assetId);
    if (a.acquisitionFingerprint !== imagePlanFingerprint(sectionId, plan, research))
      throw Error('asset_plan_changed:' + plan.slotId);
    if (
      (plan.mode === 'download' && (a.query !== plan.query || a.engine !== plan.engine)) ||
      (plan.mode === 'download' &&
        plan.engine === 'direct' &&
        (a.requestedUrl ?? a.originalUrl) !== plan.imageUrl) ||
      (plan.mode === 'capture' && a.selector !== plan.selector)
    )
      throw Error('asset_metadata:' + plan.slotId);
    const attempt = await optionalJson<{ status: string }>(
      await safeFile(job, `receipts/attempt-${plan.slotId}.json`),
    );
    if (attempt && attempt.status !== 'success')
      throw Error('asset_attempt_incomplete:' + plan.slotId);
    const bytes = await readFile(await safeFile(job, a.relativePath));
    let meta;
    try {
      meta = await sharp(bytes).metadata();
    } catch {
      throw Error('asset_decode:' + plan.slotId);
    }
    if (
      !['png', 'jpeg', 'webp'].includes(meta.format ?? '') ||
      !meta.width ||
      !meta.height ||
      meta.width !== a.width ||
      meta.height !== a.height ||
      sha256(bytes) !== a.sha256
    )
      throw Error('asset_bytes:' + plan.slotId);
    if (hashes.has(a.sha256)) throw Error('duplicate_image:' + plan.slotId);
    hashes.add(a.sha256);
    ordered.push(a);
  }
  return ordered;
}
export async function putAsset(
  job: string,
  request: JobRequest,
  post: Post,
  asset: Asset,
): Promise<void> {
  const path = await safeFile(job, 'assets.json'),
    old = await optionalJson<AssetManifest>(path);
  const validSlots = new Set(plannedImages(post).map((x) => x.plan.slotId));
  const assets = (old?.assets ?? []).filter(
    (a) => a.slotId !== asset.slotId && validSlots.has(a.slotId),
  );
  assets.push(asset);
  await atomicJson(path, {
    schemaVersion: 1,
    planFingerprint: fingerprint({ request, post }),
    assets,
  });
}
