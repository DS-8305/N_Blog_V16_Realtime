import type { Research } from './types.js';
import rules from '../../config/editorial-rules.json' with { type: 'json' };
import { dateValue } from './validation.js';

const hour = 60 * 60 * 1000;
const windowMs = rules.researchWindowHours * hour;
const clockToleranceMs = 5 * 60 * 1000;

function dateInterval(value: unknown): { start: number; end: number } | null {
  if (!dateValue(value)) return null;
  const text = value as string;
  if (text.length === 10) {
    // A date is a Seoul calendar day, not a fabricated UTC publication time.
    const start = Date.parse(text + 'T00:00:00+09:00');
    return { start, end: start + 24 * hour - 1 };
  }
  const time = Date.parse(text);
  return { start: time, end: time };
}

export function validateFreshness(data: Research, now = Date.now()): string[] {
  const errors: string[] = [];
  const researched = Date.parse(data.researchedAt);
  if (Number.isFinite(researched) && researched < now - windowMs) errors.push('research_stale');
  const recent = new Set<string>();
  for (const source of data.sources ?? []) {
    if (!source) continue;
    const dates = [source.publishedAt, source.updatedAt]
      .map(dateInterval)
      .filter((d) => d !== null);
    if (dates.some((d) => d.start > now + clockToleranceMs))
      errors.push('source_in_future:' + source.sourceId);
    if (dates.some((d) => d.start <= now && d.end >= now - windowMs)) recent.add(source.sourceId);
  }
  const current = (Array.isArray(data.facts) ? data.facts : []).filter(
    (fact) => fact && (fact.temporalRole === undefined || fact.temporalRole === 'current'),
  );
  if (!current.length) errors.push('current_fact_required');
  for (const fact of current)
    if (!Array.isArray(fact.sourceIds) || !fact.sourceIds.some((id) => recent.has(id)))
      errors.push('fact_not_recent:' + fact.factId);
  return errors;
}
