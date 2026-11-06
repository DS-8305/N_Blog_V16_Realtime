import { readFile } from 'node:fs/promises';
import type {
  Asset,
  AssetManifest,
  ImagePlan,
  JobRequest,
  Post,
  Research,
} from '../domain/types.js';
import { readContent } from '../editorial/bundle.js';
import { plannedImages } from '../editorial/post.js';
import { assertMutable } from '../state/jobs.js';
import { acquireLock, safeFile, optionalJson, atomicJson, sha256 } from '../state/files.js';
import { putAsset } from './assets.js';
import { imagePlanFingerprint } from './plan.js';
export async function acquireSlots(
  job: string,
  mode: 'download' | 'capture',
  operation: (
    item: { sectionId: string; plan: ImagePlan },
    used: Set<string>,
    content: { request: JobRequest; post: Post; research: Research },
  ) => Promise<Asset>,
  slot?: string,
) {
  const unlock = await acquireLock(await safeFile(job, 'job.lock'));
  try {
    await assertMutable(job);
    const content = await readContent(job),
      plans = plannedImages(content.post).filter(
        (p) => p.plan.mode === mode && (!slot || p.plan.slotId === slot),
      );
    if (slot && !plans.length) throw Error('image_slot_not_found');
    const old = await optionalJson<AssetManifest>(await safeFile(job, 'assets.json'));
    const currentPlans = plannedImages(content.post);
    const used = new Set(
      (old?.assets ?? [])
        .filter(
          (a) =>
            !plans.some((p) => p.plan.slotId === a.slotId) &&
            currentPlans.some(
              (p) =>
                p.plan.slotId === a.slotId &&
                a.acquisitionFingerprint ===
                  imagePlanFingerprint(p.sectionId, p.plan, content.research),
            ),
        )
        .map((a) => a.sha256),
    );
    for (const item of plans) {
      const acquisitionFingerprint = imagePlanFingerprint(
        item.sectionId,
        item.plan,
        content.research,
      );
      const prior = old?.assets.find((a) => a.slotId === item.plan.slotId),
        attemptPath = await safeFile(job, `receipts/attempt-${item.plan.slotId}.json`),
        attempt = await optionalJson<{ status: string }>(attemptPath);
      if (
        prior &&
        prior.acquisitionFingerprint === acquisitionFingerprint &&
        attempt?.status === 'success'
      ) {
        try {
          const bytes = await readFile(await safeFile(job, prior.relativePath));
          if (sha256(bytes) === prior.sha256 && !used.has(prior.sha256)) {
            used.add(prior.sha256);
            await putAsset(job, content.request, content.post, prior);
            continue;
          }
        } catch {
          /* Re-acquire invalid prior output. */
        }
      }
      await atomicJson(attemptPath, {
        status: 'running',
        slotId: item.plan.slotId,
        startedAt: new Date().toISOString(),
      });
      try {
        const asset = { ...(await operation(item, used, content)), acquisitionFingerprint };
        if (used.has(asset.sha256)) throw Error('duplicate_image:' + item.plan.slotId);
        await putAsset(job, content.request, content.post, asset);
        await atomicJson(await safeFile(job, `receipts/asset-${item.plan.slotId}.json`), asset);
        await atomicJson(attemptPath, {
          status: 'success',
          slotId: item.plan.slotId,
          sha256: asset.sha256,
          completedAt: new Date().toISOString(),
        });
        used.add(asset.sha256);
      } catch (e) {
        await atomicJson(attemptPath, {
          status: 'failed',
          slotId: item.plan.slotId,
          error: (e as Error).message,
        });
        throw e;
      }
    }
  } finally {
    await unlock();
  }
}
