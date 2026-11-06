import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validateResearch } from '../src/domain/validation.js';
import { validatePost } from '../src/editorial/post.js';
import { samplePost, sampleResearch } from './helpers.js';

const now = '2026-11-06T09:00:00Z';
const request = {
  createdAt: now,
  conditions: {
    bodyMin: 1000,
    bodyMax: 1600,
    sectionCount: 4,
    imagesPerSection: 2,
    imageMin: 10,
    imageMax: 12,
  },
} as any;
beforeEach(() => vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] }));
afterEach(() => vi.useRealTimers());
function research() {
  const r = sampleResearch();
  r.researchedAt = now;
  r.sources[0].accessedAt = now;
  r.sources[0].publishedAt = now;
  return r;
}
it('rejects old news even when accessed and researched today', () => {
  const r = research();
  r.sources[0].publishedAt = '2024-11-04';
  expect(validateResearch(request, r)).toContain('fact_not_recent:f1');
});
it('requires a current fact rather than only background sources', () => {
  const r = research();
  (r.facts[0] as any).temporalRole = 'background';
  expect(validateResearch(request, r)).toContain('current_fact_required');
});
it('allows dated historical background alongside a supported current fact', () => {
  const r = research();
  r.sources.push({ ...r.sources[0], sourceId: 'old', publishedAt: '2024-11-04' });
  r.facts.push({
    factId: 'background',
    text: '과거 배경',
    sourceIds: ['old'],
    temporalRole: 'background',
  } as any);
  expect(validateResearch(request, r)).toEqual([]);
});
it('requires a recent source for each current fact, not an unrelated fresh source', () => {
  const r = research();
  r.sources.push({ ...r.sources[0], sourceId: 'old', publishedAt: '2024-11-04' });
  r.facts[0].sourceIds = ['old'];
  expect(validateResearch(request, r)).toContain('fact_not_recent:f1');
});
it('does not use an accessed date as an unknown publication date', () => {
  const r = research();
  r.sources[0].publishedAt = null;
  expect(validateResearch(request, r)).toContain('fact_not_recent:f1');
});
it('rejects a stale research bundle', () => {
  const r = research();
  r.researchedAt = '2026-11-03T08:59:59Z';
  expect(validateResearch(request, r)).toContain('research_stale');
});
it.each(['publishedAt', 'updatedAt'] as const)(
  'rejects a future %s rather than using it as current evidence',
  (field) => {
    const r = research();
    r.sources[0][field] = '2027-11-06T09:00:00Z';
    expect(validateResearch(request, r)).toContain('source_in_future:s1');
  },
);
it.each([
  ['2026-11-03T09:00:00Z', true],
  ['2026-11-03T08:59:59Z', false],
  ['2026-11-06', true],
  ['2026-11-03', true],
  ['2026-11-02', false],
  ['2026-11-07', false],
] as const)(
  'checks publication window %s without inventing a date-only publication time',
  (publishedAt, accepted) => {
    const r = research();
    r.sources[0].publishedAt = publishedAt;
    expect(validateResearch(request, r).includes('fact_not_recent:f1')).toBe(!accepted);
  },
);
it('uses the Seoul calendar day near midnight, not the UTC date', () => {
  vi.setSystemTime(new Date('2026-11-06T15:05:00Z'));
  const r = research();
  r.researchedAt = '2026-11-07T00:05:00+09:00';
  r.sources[0].accessedAt = r.researchedAt;
  r.sources[0].publishedAt = '2026-11-07';
  expect(validateResearch(request, r)).toEqual([]);
});
it('allows a verified recent update to an older publication', () => {
  const r = research();
  r.sources[0].publishedAt = '2024-11-04';
  r.sources[0].updatedAt = now;
  expect(validateResearch(request, r)).toEqual([]);
});
it('rejects an unknown fact temporal role', () => {
  const r = research();
  (r.facts[0] as any).temporalRole = 'whatever';
  expect(validateResearch(request, r)).toContain('fact_temporal_role:f1');
});
it('rejects a post citing only background facts while its current fact is unused', () => {
  const r = research(),
    p = samplePost();
  r.facts.push({
    factId: 'old',
    text: '배경',
    sourceIds: ['s1'],
    temporalRole: 'background',
  } as any);
  p.sections.forEach((s) => (s.factIds = ['old']));
  expect(validatePost(request, r, p)).toContain('post_current_fact_required');
});
