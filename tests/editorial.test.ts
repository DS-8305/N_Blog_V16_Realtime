import { it, expect, afterEach } from 'vitest';
import { rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { samplePost, sampleResearch, fixture, mobileText } from './helpers.js';
import { findBannedPhrases } from '../src/editorial/bannedPhrases.js';
import {
  bodyLength,
  titleSimilarities,
  validatePost,
  validateBodyStyleWarnings,
} from '../src/editorial/post.js';
import { preparePost, recordReview, loadDraft, photoSourceLine } from '../src/editorial/bundle.js';
import { atomicJson, fingerprint } from '../src/state/files.js';
import relatedPosts from '../config/related-posts.json' with { type: 'json' };
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const request: any = {
  conditions: { bodyMin: 1000, bodyMax: 1200, sectionCount: 4, imagesPerSection: 3 },
};
it.each([
  [999, false],
  [1000, true],
  [1200, true],
  [1201, false],
])('checks body boundary %s without counting image captions', (size, valid) => {
  const p = samplePost(size as number);
  p.sections[0].images[0].caption = '캡션'.repeat(200);
  expect(bodyLength(p)).toBe(size);
  expect(!validatePost(request, sampleResearch(), p).includes('body_length')).toBe(valid);
});
it('requires three images beneath every heading, even if total count is twelve', () => {
  const p = samplePost();
  p.sections[1].images.push(p.sections[0].images.pop()!);
  expect(validatePost(request, sampleResearch(), p)).toContain('section_image_count:sec1');
});
it('rejects duplicate slots and nonexistent fact references', () => {
  const p = samplePost();
  p.sections[0].images[1].slotId = p.sections[0].images[0].slotId;
  p.sections[0].factIds = ['unknown'];
  const e = validatePost(request, sampleResearch(), p);
  expect(e).toContain('duplicate_slot:s1-1');
  expect(e).toContain('section_fact:sec1');
});
it('compares normalized character bigrams and reports article coverage separately', () => {
  const p = samplePost();
  p.title = '가 나,다!라 마';
  const research = sampleResearch();
  research.sources[0].title = '가-나 다 라 바';
  expect(titleSimilarities(research, p.title)).toEqual([
    {
      sourceId: 's1',
      articleTitle: '가-나 다 라 바',
      jaccardPercent: 60,
      articleCoveragePercent: 75,
    },
  ]);
});
it('rejects a selected title at the 60% Jaccard boundary', () => {
  const p = samplePost();
  p.titleCandidates[0] = '가 나,다!라 마';
  p.title = p.titleCandidates[0];
  const research = sampleResearch();
  research.sources[0].title = '가-나 다 라 바';
  expect(validatePost(request, research, p)).toContain(
    'title_overlap:s1:jaccard=60%:articleCoverage=75%',
  );
});
it('accepts a title below 60% even when it covers every article bigram', () => {
  const p = samplePost();
  p.titleCandidates[0] = '가나다라마바사';
  p.title = p.titleCandidates[0];
  const research = sampleResearch();
  research.sources[0].title = '가나다';
  expect(titleSimilarities(research, p.title)[0]).toEqual({
    sourceId: 's1',
    articleTitle: '가나다',
    jaccardPercent: 33.33,
    articleCoveragePercent: 100,
  });
  const errors = validatePost(request, research, p);
  expect(errors.some((error) => error.startsWith('title_overlap:'))).toBe(false);
  expect(errors).toContain('title_length:0');
});
it('checks every researched title against the final title', () => {
  const p = samplePost();
  p.titleCandidates[0] = '가나다라마바사';
  p.title = p.titleCandidates[0];
  const research = sampleResearch();
  research.sources[0].title = '가나다';
  research.sources.push({ ...research.sources[0], sourceId: 's2', title: '나다라마바사' });
  expect(titleSimilarities(research, p.title).map((result) => result.sourceId)).toEqual([
    's1',
    's2',
  ]);
  expect(validatePost(request, research, p)).toContain(
    'title_overlap:s2:jaccard=83.33%:articleCoverage=100%',
  );
});
it('compiles thirteen ordered images and binds a review to actual image bytes', async () => {
  const f = await fixture(1000, true);
  roots.push(f.root);
  const basis = await preparePost(f.job);
  await recordReview(f.job, basis.fingerprint, 'test-reviewer');
  const draft = await loadDraft(f.job);
  expect(draft.expected.imageAssetIds).toEqual([
    's1-1',
    's1-2',
    's1-3',
    'extra',
    's2-1',
    's2-2',
    's2-3',
    's3-1',
    's3-2',
    's3-3',
    's4-1',
    's4-2',
    's4-3',
  ]);
  expect(draft.events.filter((e) => e.type === 'setImageCaption')).toHaveLength(0);
  expect(draft.expected.captions).toEqual([]);
  const preview = await readFile(join(f.job, 'preview.md'), 'utf8');
  expect(preview).toContain('![s1-1](images/s1-1.png)');
  expect(preview).not.toContain('사진=');
  expect(preview.match(/사진 출처 :/g)).toHaveLength(1);
  expect(preview).toContain('사진 출처 : 매체A, 매체B, 매체C, 매체D');
  expect(preview).not.toContain('자료 출처');
  expect(preview).not.toContain('테스트 기관 — 테스트용 발표');
  expect(preview).not.toContain('https://example.org/news');
  expect(draft.expected.sources).toEqual(['사진 출처 : 매체A, 매체B, 매체C, 매체D']);
  expect(draft.expected.bodyText).toContain('사진 출처 : 매체A, 매체B, 매체C, 매체D');
  expect(draft.expected.bodyText).not.toContain('https://example.org/news');
  await writeFile(join(f.job, 'images/s1-1.png'), Buffer.from('corrupt'));
  await expect(loadDraft(f.job)).rejects.toThrow(/asset/);
});
it.each([false, true])(
  'inserts the three configured related links in order with placeholders present: %s',
  async (withPlaceholders) => {
    const f = await fixture();
    roots.push(f.root);
    f.post.conclusion = [
      '한 줄 정리: 소식이에요',
      '여러분은 어떻게 생각하세요?',
      '함께 보기 좋은 이슈',
      ...(withPlaceholders ? ['[내 글 카드 1]', '[내 글 카드 2]', '[내 글 카드 3]'] : []),
    ];
    await atomicJson(join(f.job, 'post.json'), f.post);
    await atomicJson(join(f.job, 'assets.json'), {
      schemaVersion: 1,
      planFingerprint: fingerprint({ request: f.request, post: f.post }),
      assets: f.assets,
    });
    const basis = await preparePost(f.job);
    await recordReview(f.job, basis.fingerprint, 'test-reviewer');
    const draft = await loadDraft(f.job);
    const links = relatedPosts.links;
    const closing = draft.events.slice(
      draft.events.findIndex(
        (event) => event.type === 'insertQuote' && event.text === '함께 보기 좋은 이슈',
      ),
      -2,
    );
    expect(closing).toEqual([
      { type: 'insertQuote', text: '함께 보기 좋은 이슈', bold: true },
      ...links.map((text) => ({ type: 'typeText', text })),
    ]);
    expect(draft.expected.bodyText).toContain(links.join('\n'));
    expect(draft.expected.bodyText).not.toContain('[내 글 카드');
    const preview = await readFile(join(f.job, 'preview.md'), 'utf8');
    expect(preview).toContain(`## 함께 보기 좋은 이슈\n\n${links.join('\n\n')}`);
    expect(preview).not.toContain('[내 글 카드');
  },
);
it('handles single-block conclusion with prefix "인용구 소제목: 함께 보기 좋은 이슈" and inserts related links', async () => {
  const f = await fixture();
  roots.push(f.root);
  f.post.conclusion = [
    '한 줄 정리: 테스트 내용이에요.\n\n여러분은 어떠신가요?\n\n인용구 소제목: 함께 보기 좋은 이슈',
  ];
  await atomicJson(join(f.job, 'post.json'), f.post);
  await atomicJson(join(f.job, 'assets.json'), {
    schemaVersion: 1,
    planFingerprint: fingerprint({ request: f.request, post: f.post }),
    assets: f.assets,
  });
  const basis = await preparePost(f.job);
  await recordReview(f.job, basis.fingerprint, 'test-reviewer');
  const draft = await loadDraft(f.job);
  const links = relatedPosts.links;
  const quoteIndex = draft.events.findIndex(
    (event) => event.type === 'insertQuote' && event.text === '함께 보기 좋은 이슈',
  );
  expect(quoteIndex).toBeGreaterThan(0);
  const closing = draft.events.slice(quoteIndex, -2);
  expect(closing).toEqual([
    { type: 'insertQuote', text: '함께 보기 좋은 이슈', bold: true },
    ...links.map((text) => ({ type: 'typeText', text })),
  ]);
  const preview = await readFile(join(f.job, 'preview.md'), 'utf8');
  expect(preview).toContain(`## 함께 보기 좋은 이슈\n\n${links.join('\n\n')}`);
});
it('invalidates a content review when the manuscript changes', async () => {
  const f = await fixture();
  roots.push(f.root);
  const b = await preparePost(f.job);
  await recordReview(f.job, b.fingerprint, 'test');
  f.post.title = f.post.titleCandidates[1];
  await atomicJson(join(f.job, 'post.json'), f.post);
  await expect(loadDraft(f.job)).rejects.toThrow(/review_stale|asset_plan_stale/);
});
it('supports entertainment rules with 1000-1600 characters, 4-6 sections, and 10-12 images', () => {
  const req: any = {
    conditions: {
      bodyMin: 1000,
      bodyMax: 1600,
      sectionMin: 4,
      sectionMax: 6,
      sectionCount: 4,
      imagesPerSection: 2,
      imageMin: 10,
      imageMax: 12,
    },
  };
  const p = samplePost(1500);
  // Default samplePost has 4 sections and 12 images
  expect(validatePost(req, sampleResearch(), p)).toEqual([]);

  // Boundary 1600 chars
  const p1600 = samplePost(1600);
  expect(validatePost(req, sampleResearch(), p1600)).toEqual([]);

  // Boundary 1601 chars fails
  const p1601 = samplePost(1601);
  expect(validatePost(req, sampleResearch(), p1601)).toContain('body_length');

  // 5 sections with 2 images each = 10 images
  const p5 = samplePost(1200);
  p5.sections.push({
    sectionId: 'sec5',
    heading: '다섯 번째 항목',
    paragraphs: ['본문 내용', '다음 내용'],
    factIds: ['f1'],
    images: [
      { slotId: 's5-1', mode: 'download', query: 'q', engine: 'google' },
      { slotId: 's5-2', mode: 'download', query: 'q', engine: 'google' },
    ],
  });
  // Adjust others to 2 images each: 2 * 5 = 10 images total
  p5.sections[0].images.pop();
  p5.sections[1].images.pop();
  p5.sections[2].images.pop();
  p5.sections[3].images.pop();
  p5.sections.slice(0, 4).forEach((section) => section.paragraphs.pop());
  expect(p5.sections).toHaveLength(5);
  expect(p5.sections.reduce((acc, s) => acc + s.images.length, 0)).toBe(10);
  expect(validatePost(req, sampleResearch(), p5)).toEqual([]);

  // Less than 10 images fails image_count
  p5.sections[0].images.pop();
  expect(validatePost(req, sampleResearch(), p5)).toContain('image_count');
});

it('keeps the sample body within the mobile line rules', () => {
  expect(mobileText(1000)).toHaveLength(1000);
  expect(validatePost(request, sampleResearch(), samplePost())).toEqual([]);
});
it.each(['자아내', '자아냈어요', '자아낸', '자아낼', '자아냄'])(
  'catches every form of 자아내다: %s',
  (w) => {
    expect(findBannedPhrases('웃음을 ' + w)).toEqual(['자아내']);
  },
);
it('reports banned phrases in body, headings, captions and titles with locations', () => {
  const p = samplePost();
  p.sections[0].paragraphs = ['현장의 감탄을\n자아냈어요.'];
  p.sections[1].heading = '팬들의 눈길을 끈 패션';
  p.photoSources = ['큰 웃음 매체'];
  p.conclusion = ['귀추가 주목돼요.'];
  p.titleCandidates[1] = '화제를 모으는 제목';
  const e = validatePost(request, sampleResearch(), p);
  expect(e).toContain('banned_phrase:자아내:sec1.paragraphs[0]:rewrite_without_this_expression');
  expect(e).toContain('banned_phrase:눈길을 끌:sec2.heading:rewrite_without_this_expression');
  expect(e).toContain('banned_phrase:큰 웃음:photoSources[0]:rewrite_without_this_expression');
  expect(e).toContain('banned_phrase:귀추가:conclusion[0]:rewrite_without_this_expression');
  expect(e).toContain(
    'banned_phrase:화제를 모으:titleCandidates[1]:rewrite_without_this_expression',
  );
});
it('rejects body lines over 20 characters but exempts summary, links, tags and credits', () => {
  const p = samplePost();
  p.sections[0].paragraphs = ['가'.repeat(20) + '\n' + '나'.repeat(21)];
  p.sections[0].heading = '아주 긴 소제목은 스무 글자를 넘어도 괜찮아요 정말로';
  p.conclusion = [
    '한 줄 정리: 이 줄은 스무 글자를 훌쩍 넘어도 예외로 인정돼요.',
    'https://m.blog.naver.com/example/1234567890',
    '사진 출처 : 매체A, 매체B, 매체C, 매체D, 매체E',
  ];
  const e = validatePost(request, sampleResearch(), p).filter((x) => x.startsWith('line_too_long'));
  expect(e).toEqual([
    'line_too_long:sec1.paragraphs[0]:line2:chars=21>20:"나나나나나나나나나나나나…":break_at_comma_or_connective_ending',
  ]);
});
it('rejects more than five lines without a blank line', () => {
  const p = samplePost();
  p.sections[1].paragraphs = [
    '하나\n둘\n셋\n넷\n다섯',
    '하나\n둘\n셋\n\n하나\n둘\n셋\n넷\n다섯\n여섯',
  ];
  const e = validatePost(request, sampleResearch(), p).filter((x) =>
    x.startsWith('paragraph_too_long'),
  );
  expect(e).toEqual([
    'paragraph_too_long:sec2.paragraphs[1]:block2:lines=6>5:from_line5:insert_blank_line_every_3-4_lines',
  ]);
});
it('blocks draft preparation through readContent when body style fails', async () => {
  const f = await fixture(1000);
  roots.push(f.root);
  const post = JSON.parse(await readFile(join(f.job, 'post.json'), 'utf8'));
  post.sections[0].paragraphs = ['감탄을 자아냈어요.'];
  await writeFile(join(f.job, 'post.json'), JSON.stringify(post));
  await expect(preparePost(f.job)).rejects.toThrow(
    /validation_failed:.*banned_phrase:자아내:sec1\.paragraphs\[0\]/,
  );
});
it.each([
  ['기대를 모으고', '기대를 모으'],
  ['기대를 모았어요', '기대를 모으'],
  ['기대를 모아', '기대를 모으'],
  ['기대를 모은', '기대를 모으'],
  ['기대를 모을', '기대를 모으'],
  ['기대를 모읍니다', '기대를 모으'],
  ['화제를 모았어요', '화제를 모으'],
  ['화제를 모은 장면', '화제를 모으'],
  ['이목을 집중시켰어요', '이목을 집중'],
  ['이목이 집중됐어요', '이목을 집중'],
])('catches conjugated form %s', (text, label) => {
  expect(findBannedPhrases(text)).toEqual([label]);
});

it('forbids per-photo captions and requires a single photo source line', () => {
  const p = samplePost();
  expect(validatePost(request, sampleResearch(), p)).toEqual([]);
  p.sections[0].images[0].caption = '사진 설명 (사진=매체A)';
  expect(validatePost(request, sampleResearch(), p)).toContain('image_caption_forbidden:s1-1');
  const q = samplePost();
  q.sections[0].images[0].caption = '';
  expect(validatePost(request, sampleResearch(), q)).toEqual([]);
  for (const bad of [[], [''], ['매체A', '매체A'], ['매체A, 매체B']]) {
    const r = samplePost();
    r.photoSources = bad;
    expect(validatePost(request, sampleResearch(), r)).toContain('photo_sources');
  }
  const r = samplePost();
  delete (r as Partial<typeof r>).photoSources;
  expect(validatePost(request, sampleResearch(), r)).toContain('photo_sources');
});
it('builds the photo source line from post.photoSources only', () => {
  const p = samplePost();
  p.photoSources = ['연합뉴스', ' 뉴시스 ', '싱글리스트'];
  expect(photoSourceLine(p)).toBe('사진 출처 : 연합뉴스, 뉴시스, 싱글리스트');
});

const introWarnings = (line: string) => {
  const p = samplePost();
  p.intro = [line];
  return validateBodyStyleWarnings(p).filter((w) => w.includes(':intro['));
};
it('warns on a short body line that is not a sentence end', () => {
  expect(introWarnings('반가운 이름이')).toEqual([
    'short_line:intro[0]:line1:chars=7<12:"반가운 이름이…":join_with_next_line_up_to_20_chars',
  ]);
});
it('does not warn on a short line that ends a sentence', () => {
  expect(introWarnings('주문이었어요.')).toEqual([]);
});
it('does not warn on a 15-20 character line', () => {
  expect(introWarnings('오늘 저녁 놀면 뭐하니 방송에서')).toEqual([]);
});
it('short line warnings do not fail validation', () => {
  const p = samplePost();
  p.intro = [p.intro[0] + '\n\n반가운 이름이'];
  expect(validateBodyStyleWarnings(p).some((w) => w.startsWith('short_line'))).toBe(true);
  expect(validatePost(request, sampleResearch(), p).some((e) => e.startsWith('short_line'))).toBe(
    false,
  );
});
it('appends all seven compliant title candidates after hashtags in preview and draft', async () => {
  const f = await fixture();
  roots.push(f.root);
  f.post.title = f.post.titleCandidates[0];
  expect(validatePost(request, sampleResearch(), f.post)).toEqual([]);
  await atomicJson(join(f.job, 'post.json'), f.post);
  await atomicJson(join(f.job, 'assets.json'), {
    schemaVersion: 1,
    planFingerprint: fingerprint({ request: f.request, post: f.post }),
    assets: f.assets,
  });
  const basis = await preparePost(f.job);
  await recordReview(f.job, basis.fingerprint, 'test-reviewer');
  const draft = await loadDraft(f.job);
  const preview = await readFile(join(f.job, 'preview.md'), 'utf8');
  expect(preview.indexOf('#테스트')).toBeLessThan(preview.indexOf('[제목 후보]'));
  for (const [i, title] of f.post.titleCandidates.entries()) {
    expect(preview).toContain(`${i + 1}. ${title}`);
    expect(draft.expected.bodyText).toContain(`${i + 1}. ${title}`);
  }
});
