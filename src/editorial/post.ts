import type { JobRequest, Post, Research, ImagePlan } from '../domain/types.js';
import { nonempty, webUrl } from '../domain/validation.js';
import { findBannedPhrases } from './bannedPhrases.js';
import { validateTitles, titleWarnings } from './titles.js';
import policy from '../../config/editorial-rules.json' with { type: 'json' };
import templates from '../../config/title-templates.json' with { type: 'json' };
export function bodyLength(post: Post): number {
  return [post.intro, ...post.sections.map((s) => [s.heading, ...s.paragraphs]), post.conclusion]
    .flat()
    .join('\n\n')
    .normalize('NFC').length;
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(nonempty);
type TitleSimilarity = {
  sourceId: string;
  articleTitle: string;
  jaccardPercent: number;
  articleCoveragePercent: number;
};
const titleBigrams = (title: string): Set<string> => {
  const characters = Array.from(title.normalize('NFC').replace(/[\s\p{P}]/gu, ''));
  return new Set(characters.slice(1).map((character, index) => characters[index] + character));
};
const percent = (part: number, whole: number): number =>
  whole ? Math.round((part / whole) * 10000) / 100 : 0;
function compareTitles(research: Research, title: string) {
  const postBigrams = titleBigrams(title);
  return (research.sources ?? [])
    .filter((source) => nonempty(source?.title))
    .map((source) => {
      const articleBigrams = titleBigrams(source.title);
      const shared = [...articleBigrams].filter((bigram) => postBigrams.has(bigram)).length;
      const union = new Set([...postBigrams, ...articleBigrams]).size;
      return {
        sourceId: source.sourceId,
        articleTitle: source.title,
        jaccardPercent: percent(shared, union),
        articleCoveragePercent: percent(shared, articleBigrams.size),
        overlaps: union > 0 && shared * 100 >= union * templates.rules.overlapThresholdPercent,
      };
    });
}
export function titleSimilarities(research: Research, title: string): TitleSimilarity[] {
  return compareTitles(research, title).map(({ overlaps: _overlaps, ...result }) => result);
}
export const MAX_LINE_CHARS = 20;
export const MAX_PARAGRAPH_LINES = 5;
// 줄 길이 검사에서 빼는 줄: '한 줄 정리', 링크, 태그, 사진 출처 (AGENTS.md 모바일 가독성 규칙 4)
const lineExempt = (line: string): boolean =>
  /^한\s*줄\s*정리/u.test(line) ||
  /^https?:\/\//u.test(line) ||
  line.startsWith('#') ||
  /^사진\s*출처/u.test(line);
// 오류 코드는 쉼표로 이어지므로 미리보기에서 쉼표를 뺀다.
const preview = (line: string): string =>
  Array.from(line.replace(/,/g, ' ')).slice(0, 12).join('') + '…';
type BodyText = { location: string; text: string };
function bodyTexts(p: Post): BodyText[] {
  const out: BodyText[] = [];
  (Array.isArray(p.intro) ? p.intro : []).forEach((text, i) =>
    out.push({ location: `intro[${i}]`, text }),
  );
  for (const s of Array.isArray(p.sections) ? p.sections : [])
    (Array.isArray(s?.paragraphs) ? s.paragraphs : []).forEach((text, i) =>
      out.push({ location: `${s.sectionId}.paragraphs[${i}]`, text }),
    );
  (Array.isArray(p.conclusion) ? p.conclusion : []).forEach((text, i) =>
    out.push({ location: `conclusion[${i}]`, text }),
  );
  return out.filter((b) => typeof b.text === 'string');
}
// 본문 문장 규칙: 금지 표현, 한 줄 최대 20자, 빈 줄 없이 5줄 초과 금지.
// 오류 문구는 그대로 모델에 전달되므로 위치와 고칠 방법을 담는다.
export function validateBodyStyle(p: Post): string[] {
  const e: string[] = [];
  const banned = (location: string, text: unknown) => {
    if (typeof text !== 'string') return;
    for (const label of findBannedPhrases(text))
      e.push(`banned_phrase:${label}:${location}:rewrite_without_this_expression`);
  };
  banned('title', p.title);
  (Array.isArray(p.titleCandidates) ? p.titleCandidates : []).forEach((t, i) =>
    banned(`titleCandidates[${i}]`, t),
  );
  (Array.isArray(p.photoSources) ? p.photoSources : []).forEach((t, i) =>
    banned(`photoSources[${i}]`, t),
  );
  for (const s of Array.isArray(p.sections) ? p.sections : []) {
    banned(`${s?.sectionId}.heading`, s?.heading);
    for (const image of Array.isArray(s?.images) ? s.images : [])
      banned(`${s.sectionId}.images.${image?.slotId}.caption`, image?.caption);
  }
  for (const { location, text } of bodyTexts(p)) {
    banned(location, text);
    let run = 0,
      runStart = 1,
      block = 0;
    const lines = text.normalize('NFC').split('\n');
    const closeRun = () => {
      if (run > MAX_PARAGRAPH_LINES)
        e.push(
          `paragraph_too_long:${location}:block${block}:lines=${run}>${MAX_PARAGRAPH_LINES}:from_line${runStart}:insert_blank_line_every_3-4_lines`,
        );
      run = 0;
    };
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (!line) return closeRun();
      if (run === 0) {
        block++;
        runStart = index + 1;
      }
      run++;
      if (lineExempt(line)) return;
      const length = Array.from(line).length;
      if (length > MAX_LINE_CHARS)
        e.push(
          `line_too_long:${location}:line${index + 1}:chars=${length}>${MAX_LINE_CHARS}:"${preview(line)}":break_at_comma_or_connective_ending`,
        );
    });
    closeRun();
  }
  return e;
}
export const MIN_LINE_CHARS = 12;
// 문장 끝: . ? ! … 또는 ~요/~다로 끝나는 줄(닫는 따옴표·괄호 허용).
const sentenceEnd = (line: string): boolean => /(?:[.?!…]|[요다])["'”’)\]]*$/u.test(line);
// 경고만 낸다(저장을 막지 않음): 문장 끝이 아닌 12자 미만 줄은 너무 잘게 끊긴 줄로 본다.
// 빈 줄, 소제목(본문 아님), '한 줄 정리', '사진 출처', 링크, 태그는 제외. (AGENTS.md 모바일 가독성 규칙 5)
export function validateBodyStyleWarnings(p: Post): string[] {
  const w: string[] = titleWarnings(p);
  for (const { location, text } of bodyTexts(p))
    text
      .normalize('NFC')
      .split('\n')
      .forEach((raw, index) => {
        const line = raw.trim();
        if (!line || lineExempt(line) || sentenceEnd(line)) return;
        const length = Array.from(line).length;
        if (length < MIN_LINE_CHARS)
          w.push(
            `short_line:${location}:line${index + 1}:chars=${length}<${MIN_LINE_CHARS}:"${preview(line)}":join_with_next_line_up_to_${MAX_LINE_CHARS}_chars`,
          );
      });
  return w;
}
export function validatePost(request: JobRequest, research: Research, p: Post): string[] {
  const e: string[] = [];
  if (!p || p.schemaVersion !== 1) return ['post_schema'];
  if (
    !strings(p.titleCandidates) ||
    p.titleCandidates.length !== policy.titleCandidateCount ||
    new Set(p.titleCandidates.map((t) => t.normalize('NFC').trim())).size !==
      p.titleCandidates.length ||
    !nonempty(p.title) ||
    !p.titleCandidates.includes(p.title)
  )
    e.push('title_candidates');
  e.push(...validateTitles(p));
  if (nonempty(p.title)) {
    for (const match of compareTitles(research, p.title)) {
      if (match.overlaps)
        e.push(
          `title_overlap:${match.sourceId}:jaccard=${match.jaccardPercent}%:articleCoverage=${match.articleCoveragePercent}%`,
        );
    }
  }
  if (!strings(p.intro) || !p.intro.length || !strings(p.conclusion) || !p.conclusion.length)
    e.push('post_text');
  if (
    !strings(p.tags) ||
    p.tags.length !== policy.tagCount ||
    new Set(p.tags).size !== p.tags.length ||
    p.tags.some((t) => /[\s#]/.test(t))
  )
    e.push('tags');
  if (
    !strings(p.photoSources) ||
    !p.photoSources.length ||
    p.photoSources.some((s) => !nonempty(s) || /[,\n]/.test(s)) ||
    new Set(p.photoSources.map((s) => s.trim())).size !== p.photoSources.length
  )
    e.push('photo_sources');
  const minSections = request.conditions.sectionMin ?? request.conditions.sectionCount;
  const maxSections = request.conditions.sectionMax ?? request.conditions.sectionCount;
  if (
    !Array.isArray(p.sections) ||
    p.sections.length < minSections ||
    p.sections.length > maxSections
  )
    return [...e, 'section_count'];
  const factIds = new Set(research.facts?.map((f) => f.factId)),
    sourceIds = new Set(research.sources?.map((s) => s.sourceId)),
    sections = new Set<string>(),
    slots = new Set<string>();
  const currentFacts = new Set(
    research.facts
      ?.filter((fact) => fact.temporalRole === undefined || fact.temporalRole === 'current')
      .map((fact) => fact.factId),
  );
  if (
    !p.sections.some(
      (section) =>
        Array.isArray(section?.factIds) && section.factIds.some((id) => currentFacts.has(id)),
    )
  )
    e.push('post_current_fact_required');
  const minImagesPerSection = request.conditions.imagesPerSection ?? 1;
  for (const s of p.sections) {
    if (
      !s ||
      !nonempty(s.sectionId) ||
      sections.has(s.sectionId) ||
      !nonempty(s.heading) ||
      !strings(s.paragraphs) ||
      !s.paragraphs.length
    ) {
      e.push('section_invalid');
      continue;
    }
    sections.add(s.sectionId);
    if (!Array.isArray(s.factIds) || !s.factIds.length || s.factIds.some((id) => !factIds.has(id)))
      e.push('section_fact:' + s.sectionId);
    if (!Array.isArray(s.images) || s.images.length < minImagesPerSection) {
      e.push('section_image_count:' + s.sectionId);
      if (!Array.isArray(s.images)) continue;
    }
    if (s.paragraphs.length !== s.images.length) e.push('section_text_image_count:' + s.sectionId);
    for (const image of s.images) {
      if (!image || !nonempty(image.slotId) || !/^[a-zA-Z0-9_-]{1,80}$/.test(image.slotId)) {
        e.push('image_invalid');
        continue;
      }
      if (image.caption !== undefined && image.caption !== '')
        e.push('image_caption_forbidden:' + image.slotId);
      if (slots.has(image.slotId)) e.push('duplicate_slot:' + image.slotId);
      slots.add(image.slotId);
      const slotId = image.slotId;
      if (image.mode === 'download') {
        if (
          !nonempty(image.query) ||
          !['google', 'naver', 'direct'].includes(image.engine) ||
          (image.engine === 'direct' &&
            (!sourceIds.has(image.sourceId) || !webUrl(image.imageUrl))) ||
          (image.engine === 'direct' &&
            image.candidateId !== undefined &&
            !/^img-[a-f0-9]{16}$/.test(image.candidateId)) ||
          (image.sourceId && !sourceIds.has(image.sourceId))
        )
          e.push('image_search:' + image.slotId);
      } else if (image.mode === 'capture') {
        if (
          !sourceIds.has(image.sourceId) ||
          !webUrl(image.url) ||
          !nonempty(image.selector) ||
          !strings(image.requiredLabels) ||
          !image.requiredLabels.length
        )
          e.push('image_capture:' + image.slotId);
      } else e.push('image_mode:' + slotId);
    }
  }
  const totalImages = p.sections.reduce(
    (acc, s) => acc + (Array.isArray(s.images) ? s.images.length : 0),
    0,
  );
  if (request.conditions.imageMin !== undefined && totalImages < request.conditions.imageMin) {
    e.push('image_count');
  }
  if (request.conditions.imageMax !== undefined && totalImages > request.conditions.imageMax) {
    e.push('image_count');
  }
  if (!e.includes('post_text') && !e.includes('section_invalid')) {
    const length = bodyLength(p);
    if (length < request.conditions.bodyMin || length > request.conditions.bodyMax)
      e.push('body_length');
  }
  e.push(...validateBodyStyle(p));
  return e;
}
export function plannedImages(post: Post): { sectionId: string; plan: ImagePlan }[] {
  return post.sections.flatMap((s) => s.images.map((plan) => ({ sectionId: s.sectionId, plan })));
}
