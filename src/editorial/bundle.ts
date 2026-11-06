import { writeFile } from 'node:fs/promises';
import type { JobRequest, Research, Post, PreparedDraft, EditorEvent } from '../domain/types.js';
import { readJob, assertMutable, readState, writeState } from '../state/jobs.js';
import {
  readJson,
  safeFile,
  fingerprint,
  atomicJson,
  optionalJson,
  acquireLock,
} from '../state/files.js';
import { validateResearch, type ResearchValidationOptions } from '../domain/validation.js';
import { validatePost, bodyLength } from './post.js';
import { validateAssets } from '../images/assets.js';
import relatedPosts from '../../config/related-posts.json' with { type: 'json' };
const relatedHeading = /^(?:인용구\s*소제목\s*[:=]\s*)?함께\s*보기\s*좋은\s*이슈$/;

export function normalizeConclusion(conclusion: string[]): string[] {
  const lines = conclusion.flatMap((entry) =>
    entry
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return lines.map((line) => {
    if (relatedHeading.test(line)) {
      return '함께 보기 좋은 이슈';
    }
    return line;
  });
}

function conclusionWithRelatedLinks(conclusion: string[]): string[] {
  const normalized = normalizeConclusion(conclusion);
  const headingIndex = normalized.findIndex((line) => line === '함께 보기 좋은 이슈');
  if (headingIndex < 0) return normalized;
  const rest = normalized
    .slice(headingIndex + 1)
    .filter(
      (line) => !/^\[내 글 카드\s*[1-3]\]$/.test(line.trim()) && !/^https?:\/\//.test(line.trim()),
    );
  return [...normalized.slice(0, headingIndex + 1), ...relatedPosts.links, ...rest];
}
export function extractMediaNames(captions: string[], sources: Research['sources'] = []): string[] {
  const result: string[] = [];
  const knownPublishers = sources.map((s) => s.publisher?.trim()).filter(Boolean);

  for (const caption of captions) {
    const trimmed = caption.trim();
    if (!trimmed) continue;

    const matched: string[] = [];
    const explicitRegex =
      /(?:\[|\()?(?:사진(?:\s*출처|\s*제공)?|출처)\s*[:=]\s*([가-힣A-Za-z0-9_·\s,-]+?)(?:\]|\)|$)/g;
    let match: RegExpExecArray | null;
    let foundExplicit = false;
    while ((match = explicitRegex.exec(trimmed)) !== null) {
      if (match[1]) {
        const parts = match[1]
          .split(/[,/]/)
          .map((s) => s.trim())
          .filter(Boolean);
        matched.push(...parts);
        foundExplicit = true;
      }
    }

    if (!foundExplicit) {
      const bracketMatch = trimmed.match(/[\[(]([가-힣A-Za-z0-9_·\s,-]+)[\])]\s*$/);
      if (bracketMatch && bracketMatch[1]) {
        const candidate = bracketMatch[1].trim();
        if (!/^(?:사진|설명|캡션|이미지)/.test(candidate)) {
          const parts = candidate
            .split(/[,/]/)
            .map((s) => s.trim())
            .filter(Boolean);
          matched.push(...parts);
        }
      }
    }

    if (!matched.length) {
      for (const pub of knownPublishers) {
        if (pub && trimmed.includes(pub)) {
          matched.push(pub);
        }
      }
    }

    if (!matched.length) {
      if (trimmed.length <= 15 && !/(?:설명|캡션|사진|이미지|장면|모습|인물)/.test(trimmed)) {
        matched.push(trimmed);
      }
    }

    for (const m of matched) {
      const clean = m
        .replace(/^사진\s*[:=]?\s*/, '')
        .replace(/^출처\s*[:=]?\s*/, '')
        .trim();
      if (clean && !result.includes(clean)) {
        result.push(clean);
      }
    }
  }

  return result;
}
export function photoSourceLine(post: Post): string {
  const names = (post.photoSources ?? []).map((s) => s.trim()).filter(Boolean);
  return names.length ? `사진 출처 : ${[...new Set(names)].join(', ')}` : '';
}
export async function readContent(job: string, options: ResearchValidationOptions = {}) {
  const request = await readJob(job),
    research = await readJson<Research>(await safeFile(job, 'research.json')),
    post = await readJson<Post>(await safeFile(job, 'post.json'));
  const errors = [
    ...validateResearch(request, research, options),
    ...validatePost(request, research, post),
  ];
  if (errors.length) throw Error('validation_failed:' + errors.join(','));
  return { request, research, post };
}
export async function draftBasis(job: string, options: ResearchValidationOptions = {}) {
  const content = await readContent(job, options),
    assets = await validateAssets(job, content.request, content.post, {
      allowHistoricalSources: options.checkFreshness === false,
    });
  return { ...content, assets, fingerprint: fingerprint({ ...content, assets, relatedPosts }) };
}
export async function preparePost(job: string) {
  const unlock = await acquireLock(await safeFile(job, 'job.lock'));
  try {
    await assertMutable(job);
    const b = await draftBasis(job);
    const lines = [`# ${b.post.title}`, '', ...b.post.intro, ''];
    for (const s of b.post.sections) {
      lines.push(`## ${s.heading}`, '');
      for (const [index, p] of s.images.entries()) {
        const a = b.assets.find((a) => a.slotId === p.slotId)!;
        lines.push(`![${p.slotId}](${a.relativePath})`, '');
        lines.push(s.paragraphs[index], '');
      }
    }
    const sourceLine = photoSourceLine(b.post);
    const conclusionLines = conclusionWithRelatedLinks(b.post.conclusion).map((c) =>
      c === '함께 보기 좋은 이슈' || relatedHeading.test(c.trim()) ? `## 함께 보기 좋은 이슈` : c,
    );
    lines.push(
      ...conclusionLines,
      ...(sourceLine ? ['', sourceLine] : []),
      '',
      b.post.tags.map((t) => '#' + t).join(' '),
      ...(b.post.titleCandidates && b.post.titleCandidates.length
        ? ['', '[제목 후보]', ...b.post.titleCandidates.map((t, i) => `${i + 1}. ${t}`)]
        : []),
    );
    await writeFile(await safeFile(job, 'preview.md'), lines.join('\n\n'), 'utf8');
    const state = await readState(job);
    await writeState(job, { ...state, phase: 'assets_ready', error: null });
    return {
      fingerprint: b.fingerprint,
      bodyLength: bodyLength(b.post),
      imageCount: b.assets.length,
      preview: await safeFile(job, 'preview.md'),
    };
  } finally {
    await unlock();
  }
}
export async function recordReview(
  job: string,
  basisFingerprint: string,
  reviewer: string,
): Promise<void> {
  const unlock = await acquireLock(await safeFile(job, 'job.lock'));
  try {
    await assertMutable(job);
    const b = await draftBasis(job);
    if (b.fingerprint !== basisFingerprint) throw Error('review_basis_changed');
    if (!reviewer.trim()) throw Error('reviewer_required');
    await atomicJson(await safeFile(job, 'review.json'), {
      schemaVersion: 1,
      fingerprint: b.fingerprint,
      reviewer,
      reviewedAt: new Date().toISOString(),
    });
    await writeState(job, { ...(await readState(job)), phase: 'reviewed', error: null });
  } finally {
    await unlock();
  }
}
export async function loadDraft(
  job: string,
  options: ResearchValidationOptions = {},
): Promise<PreparedDraft> {
  const b = await draftBasis(job, options),
    review = await optionalJson<{
      schemaVersion: number;
      fingerprint: string;
      reviewer: string;
      reviewedAt: string;
    }>(await safeFile(job, 'review.json'));
  if (
    !review ||
    review.schemaVersion !== 1 ||
    review.fingerprint !== b.fingerprint ||
    !review.reviewer ||
    !Number.isFinite(Date.parse(review.reviewedAt))
  )
    throw Error('review_stale_or_missing');
  const events: EditorEvent[] = [{ type: 'setTitle', text: b.post.title }];
  const add = (text: string) => events.push({ type: 'typeText', text });
  b.post.intro.forEach(add);
  for (const s of b.post.sections) {
    events.push({ type: 'insertQuote', text: s.heading, bold: true });
    for (const [index, p] of s.images.entries()) {
      const a = b.assets.find((a) => a.slotId === p.slotId)!;
      events.push({
        type: 'insertImage',
        assetId: a.assetId,
        absolutePath: await safeFile(job, a.relativePath),
      });
      add(s.paragraphs[index]);
    }
  }
  for (const c of conclusionWithRelatedLinks(b.post.conclusion)) {
    if (c === '함께 보기 좋은 이슈' || relatedHeading.test(c.trim())) {
      events.push({ type: 'insertQuote', text: '함께 보기 좋은 이슈', bold: true });
    } else {
      add(c);
    }
  }
  const sourceLine = photoSourceLine(b.post);
  if (sourceLine) add('\n' + sourceLine);
  let endText = '\n' + b.post.tags.map((t) => '#' + t).join(' ');
  if (b.post.titleCandidates && b.post.titleCandidates.length) {
    endText +=
      '\n\n[제목 후보]\n' + b.post.titleCandidates.map((t, i) => `${i + 1}. ${t}`).join('\n');
  }
  add(endText);
  return {
    jobPath: job,
    jobId: b.request.jobId,
    blogId: b.request.blogId,
    fingerprint: b.fingerprint,
    title: b.post.title,
    events,
    assets: await Promise.all(
      b.assets.map(async (a) => ({ ...a, absolutePath: await safeFile(job, a.relativePath) })),
    ),
    expected: {
      bodyText: events
        .filter((e): e is Exclude<EditorEvent, { type: 'insertImage' }> => e.type !== 'insertImage')
        .filter((e) => e.type !== 'setTitle')
        .map((e) => e.text)
        .join('\n'),
      imageAssetIds: b.assets.map((a) => a.assetId),
      captions: [],
      sources: sourceLine ? [sourceLine] : [],
    },
  };
}
