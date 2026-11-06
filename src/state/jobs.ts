import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config, JobRequest, JobState } from '../domain/types.js';
import { atomicJson, exists, readJson, safeFile } from './files.js';
import { validateConditions } from '../config.js';
export async function readJob(path: string): Promise<JobRequest> {
  const r = await readJson<JobRequest>(await safeFile(path, 'request.json'));
  if (
    r.schemaVersion !== 1 ||
    !r.jobId ||
    !r.topic?.trim() ||
    !r.blogId ||
    !/^[a-zA-Z0-9_-]+$/.test(r.blogId) ||
    r.timezone !== 'Asia/Seoul' ||
    !Number.isFinite(Date.parse(r.createdAt))
  )
    throw Error('invalid_request');
  validateConditions(r.conditions);
  return r;
}
export async function initJob(config: Config, topic: string): Promise<string> {
  if (!topic?.trim()) throw Error('topic_required');
  if (!config.blogId) throw Error('blog_id_required');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replaceAll('-', '');
  const jobId = `issue-${date}-${randomUUID().slice(0, 8)}`,
    path = join(config.workspaceRoot, jobId);
  await mkdir(path, { recursive: true });
  await mkdir(join(path, 'images'));
  await mkdir(join(path, 'receipts'));
  await mkdir(join(path, 'checkpoints'));
  const request: JobRequest = {
    schemaVersion: 1,
    jobId,
    topic: topic.trim(),
    createdAt: new Date().toISOString(),
    timezone: 'Asia/Seoul',
    blogId: config.blogId,
    conditions: config.conditions,
  };
  await atomicJson(join(path, 'request.json'), request);
  await atomicJson(join(path, 'state.json'), {
    schemaVersion: 1,
    phase: 'initialized',
    error: null,
  });
  await atomicJson(join(path, 'research.json'), {
    schemaVersion: 1,
    researchedAt: null,
    sources: [],
    facts: [],
  });
  const sectionCount = config.conditions.sectionCount ?? config.conditions.sectionMin ?? 4;
  const targetImageCount =
    config.conditions.imageMin ?? sectionCount * (config.conditions.imagesPerSection ?? 2);
  const imagesPerSection = Math.max(
    config.conditions.imagesPerSection ?? 2,
    Math.ceil(targetImageCount / sectionCount),
  );
  const uniformCount = imagesPerSection * sectionCount;
  const totalImages =
    config.conditions.imageMax !== undefined && uniformCount > config.conditions.imageMax
      ? Math.max(targetImageCount, sectionCount * config.conditions.imagesPerSection)
      : uniformCount;
  const sections = Array.from({ length: sectionCount }, (_, i) => ({
    sectionId: `section-${i + 1}`,
    heading: '',
    paragraphs: [],
    factIds: [],
    images: Array.from(
      { length: Math.floor(totalImages / sectionCount) + (i < totalImages % sectionCount ? 1 : 0) },
      (_, j) => ({
        slotId: `s${i + 1}-${j + 1}`,
        mode: 'download',
        engine: 'google',
        query: '',
        caption: '',
      }),
    ),
  }));
  await atomicJson(join(path, 'post.json'), {
    schemaVersion: 1,
    titleCandidates: [],
    titleTemplateIds: [],
    title: '',
    photoSources: [],
    intro: [],
    sections,
    conclusion: [],
    tags: [],
  });
  return path;
}
export async function readState(path: string): Promise<JobState> {
  const s = await readJson<JobState>(await safeFile(path, 'state.json'));
  if (s.schemaVersion !== 1 || typeof s.phase !== 'string') throw Error('invalid_state');
  return s;
}
export async function writeState(path: string, state: JobState) {
  await atomicJson(await safeFile(path, 'state.json'), state);
}
export async function assertMutable(path: string): Promise<void> {
  const s = await readState(path);
  if (
    s.saveAttempt ||
    s.receipt ||
    [
      'inserting',
      'save_attempted',
      'draft_saved',
      'input_unconfirmed',
      'draft_unconfirmed',
    ].includes(s.phase) ||
    (await exists(await safeFile(path, 'input-intent.json'))) ||
    (await exists(await safeFile(path, 'checkpoints/progress.json')))
  )
    throw Error('job_immutable');
}
