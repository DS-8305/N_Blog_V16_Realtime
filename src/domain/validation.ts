import type { JobRequest, Research } from './types.js';
import { validateFreshness } from './freshness.js';
export const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export function webUrl(value: unknown): boolean {
  try {
    const u = new URL(String(value));
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function dateValue(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const calendar = value.slice(0, 10);
  return new Date(calendar + 'T00:00:00Z').toISOString().slice(0, 10) === calendar;
}
export interface ResearchValidationOptions {
  /** Only immutable receipt retrieval / already-dispatched save confirmation may disable this. */
  checkFreshness?: boolean;
}
export function validateResearch(
  request: JobRequest,
  data: Research,
  options: ResearchValidationOptions = {},
): string[] {
  const errors: string[] = [];
  if (!data || data.schemaVersion !== 1 || !dateValue(data.researchedAt))
    errors.push('research_timestamp');
  if (!Array.isArray(data?.sources) || !data.sources.length) return [...errors, 'sources_required'];
  const ids = new Set<string>();
  for (const s of data.sources) {
    if (
      !s ||
      !nonempty(s.sourceId) ||
      ids.has(s.sourceId) ||
      !nonempty(s.title) ||
      !nonempty(s.publisher) ||
      !webUrl(s.url)
    )
      errors.push('source_invalid:' + s?.sourceId);
    else ids.add(s.sourceId);
    if (
      !dateValue(s?.accessedAt) ||
      (s?.publishedAt !== null && !dateValue(s?.publishedAt)) ||
      (s?.updatedAt !== null && !dateValue(s?.updatedAt))
    )
      errors.push('source_date:' + s?.sourceId);
  }
  if (!Array.isArray(data.facts) || !data.facts.length) errors.push('facts_required');
  else {
    const seen = new Set<string>();
    for (const f of data.facts) {
      if (!f || !nonempty(f.factId) || seen.has(f.factId) || !nonempty(f.text))
        errors.push('fact_invalid:' + f?.factId);
      if (f?.temporalRole !== undefined && !['current', 'background'].includes(f.temporalRole))
        errors.push('fact_temporal_role:' + f?.factId);
      seen.add(f?.factId);
      if (
        !Array.isArray(f?.sourceIds) ||
        !f.sourceIds.length ||
        f.sourceIds.some((id) => !ids.has(id))
      )
        errors.push('fact_source:' + f?.factId);
    }
  }
  if (dateValue(data.researchedAt) && Date.parse(data.researchedAt) > Date.now() + 300000)
    errors.push('research_in_future');
  if (options.checkFreshness !== false) errors.push(...validateFreshness(data));
  return errors;
}
