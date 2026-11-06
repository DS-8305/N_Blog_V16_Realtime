import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { resolveConfig } from '../src/config.js';
import { initJob, readJob } from '../src/state/jobs.js';
import { atomicJson, fingerprint, sha256 } from '../src/state/files.js';
import type { Post, Research, Asset, AssetManifest } from '../src/domain/types.js';
import { imagePlanFingerprint } from '../src/images/plan.js';
export function sampleResearch(): Research {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    researchedAt: now,
    sources: [
      {
        sourceId: 's1',
        title: '테스트용 발표',
        publisher: '테스트 기관',
        url: 'https://example.org/news',
        publishedAt: now,
        updatedAt: null,
        accessedAt: now,
      },
    ],
    facts: [{ factId: 'f1', text: '오프라인 검사 전용 사실', sourceIds: ['s1'] }],
  };
}
// 모바일 규칙(한 줄 최대 20자, 빈 줄 없이 최대 5줄)을 지키면서 길이가 정확히 n인 본문.
export function mobileText(n: number): string {
  const block = Array.from({ length: 4 }, () => '가'.repeat(19)).join('\n') + '\n\n';
  const text = block.repeat(Math.ceil(n / block.length) + 1).slice(0, n);
  return text.replace(/\n+$/, (m) => '가'.repeat(m.length));
}
export function samplePost(length = 1000): Post {
  const titleCandidates = Array.from(
    { length: 7 },
    (_, i) => `${i + 1}년 만에 공개한 배우의 새로운 작품 이야기와 달라진 근황을 확인했어요`,
  );
  return {
    schemaVersion: 1,
    titleCandidates,
    titleTemplateIds: [1, 2, 3, 4, 5, 6, 7],
    title: titleCandidates[0],
    photoSources: ['매체A', '매체B', '매체C', '매체D'],
    intro: [mobileText(length - 72)],
    sections: Array.from({ length: 4 }, (_, i) => ({
      sectionId: 'sec' + (i + 1),
      heading: '항목' + (i + 1),
      paragraphs: ['본문', '본문', '본문'],
      factIds: ['f1'],
      images: Array.from({ length: 3 }, (_, j) => ({
        slotId: `s${i + 1}-${j + 1}`,
        mode: 'download' as const,
        query: `테스트 ${i + 1} 장면 ${j + 1}`,
        engine: 'google' as const,
      })),
    })),
    conclusion: ['마침'],
    tags: ['테스트', '자료', '발표', '이슈', '정리', '배우', '작품', '소식', '근황', '방송'],
  };
}
export async function fixture(length = 1000, extra = false) {
  const root = await mkdtemp(join(tmpdir(), 'nblog-fixture-')),
    config = await resolveConfig({ blogId: 'test-blog' }, root);
  // Tests that need thirteen images use an explicit custom limit, not the defaults.
  if (extra) config.conditions.imageMax = 13;
  const job = await initJob(config, '오프라인 테스트 전용');
  const request = await readJob(job),
    research = sampleResearch(),
    post = samplePost(length);
  if (extra) {
    post.sections[0].images.push({
      slotId: 'extra',
      mode: 'download',
      query: '다른 장면',
      engine: 'google',
    });
    post.sections[0].paragraphs.push('추가 본문이에요.');
  }
  await atomicJson(join(job, 'research.json'), research);
  await atomicJson(join(job, 'post.json'), post);
  const assets: Asset[] = [];
  let i = 0;
  for (const section of post.sections)
    for (const plan of section.images) {
      const bytes = await sharp({
        create: {
          width: 40 + i,
          height: 30,
          channels: 3,
          background: { r: 20 + i * 10, g: 40, b: 90 },
        },
      })
        .png()
        .toBuffer();
      const relativePath = `images/${plan.slotId}.png`;
      await writeFile(join(job, relativePath), bytes);
      assets.push({
        assetId: plan.slotId,
        acquisitionFingerprint: imagePlanFingerprint(section.sectionId, plan, research),
        sectionId: section.sectionId,
        slotId: plan.slotId,
        kind: 'download',
        relativePath,
        sha256: sha256(bytes),
        width: 40 + i,
        height: 30,
        sourceUrl: 'https://example.org/news',
        originalUrl: `https://example.org/image-${i}.png`,
        acquiredAt: '2026-10-20T00:00:00Z',
        caption: plan.caption ?? '',
        query: plan.mode === 'download' ? plan.query : '',
        engine: 'google',
      });
      i++;
    }
  const manifest: AssetManifest = {
    schemaVersion: 1,
    planFingerprint: fingerprint({ request, post }),
    assets,
  };
  await atomicJson(join(job, 'assets.json'), manifest);
  return { root, config, job, request, research, post, assets };
}
