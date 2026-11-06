import type { ImagePlan, Research } from '../domain/types.js';
import { fingerprint } from '../state/files.js';

/** Identity of the actual acquisition, independent of unrelated manuscript edits. */
export function imagePlanFingerprint(
  sectionId: string,
  plan: ImagePlan,
  research: Research,
): string {
  return fingerprint({
    sectionId,
    plan,
    sourceUrl: plan.sourceId
      ? (research.sources.find((source) => source.sourceId === plan.sourceId)?.url ?? null)
      : null,
  });
}
