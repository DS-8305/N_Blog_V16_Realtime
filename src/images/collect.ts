import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Config } from '../domain/types.js';
import { acquireSlots } from './acquire.js';
import { safeFile, readJson, sha256 } from '../state/files.js';
import { webUrl } from '../domain/validation.js';

export const COLLECTOR_TIMEOUT_MS = 240_000;
export const AUTH_WAIT_MS = 600_000;

export interface CollectorWatch {
  startedAt: number;
  timeoutMs: number;
  authWaitMs: number;
  authStartedAt: number | null;
  collectionDeadline: number;
}

export function createCollectorWatch(
  now: number,
  timeoutMs: number,
  authWaitMs = 0,
): CollectorWatch {
  return {
    startedAt: now,
    timeoutMs,
    authWaitMs,
    authStartedAt: null,
    collectionDeadline: now + timeoutMs,
  };
}

/** Collection time pauses only while the user is resolving a visible challenge. */
export function noteCollectorOutput(state: CollectorWatch, chunk: string, now: number): CollectorWatch {
  let next = state;
  for (const line of chunk.split(/\r?\n/)) {
    if (line.includes('NBLOG_AWAIT_USER_DONE')) {
      if (next.authStartedAt != null) {
        const paused = Math.max(0, now - next.authStartedAt);
        next = {
          ...next,
          authStartedAt: null,
          collectionDeadline: next.collectionDeadline + paused,
        };
      }
    } else if (line.includes('NBLOG_AWAIT_USER') && next.authStartedAt == null && next.authWaitMs > 0) {
      next = { ...next, authStartedAt: now };
    }
  }
  return next;
}

export function collectorKillAt(state: CollectorWatch): number {
  const hardCap = state.startedAt + state.timeoutMs + state.authWaitMs;
  const target =
    state.authStartedAt != null ? state.authStartedAt + state.authWaitMs : state.collectionDeadline;
  return Math.min(target, hardCap);
}

export function debuggerAddress(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.hostname}:${url.port}`;
}

export function collectorArgs(
  engine: 'google' | 'naver',
  query: string,
  outputRoot: string,
  googleCdpEndpoint: string,
): string[] {
  return [
    '-m',
    'image_collector',
    '--keyword',
    query,
    '--engine',
    engine,
    '--backend',
    'browser',
    '--limit',
    '20',
    '--output-dir',
    outputRoot,
    '--keyword-timeout',
    '120',
    ...(engine === 'google'
      ? [
          '--show-browser',
          '--cdp',
          debuggerAddress(googleCdpEndpoint),
          '--profile',
          'blog',
          '--download-mode',
          'original-preferred',
        ]
      : ['--headless', '--download-mode', 'thumbnail']),
  ];
}
interface CollectorRow {
  status: string;
  file_name: string;
  saved_path: string;
  source_url?: string;
  original_url?: string;
  downloaded_url?: string;
  download_kind?: string;
  [key: string]: unknown;
}

export const disallowedImageDomains = [
  'blog.naver.com',
  'm.blog.naver.com',
  'cafe.naver.com',
  'm.cafe.naver.com',
  'tistory.com',
  'cafe.daum.net',
  'blog.daum.net',
  'brunch.co.kr',
  'dcinside.com',
  'fmkorea.com',
  'theqoo.net',
  'instiz.net',
  'ruliweb.com',
  'inven.co.kr',
  'ppomppu.co.kr',
  'clien.net',
  'pann.nate.com',
  'bobaedream.co.kr',
  'teamblind.com',
  'mlbpark.donga.com',
  'namu.wiki',
  'wikipedia.org',
  'velog.io',
  'postype.com',
  'medium.com',
];

export function isDisallowedImageSource(urlStr?: string | null): boolean {
  if (!urlStr || typeof urlStr !== 'string') return true;
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    return disallowedImageDomains.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return true;
  }
}
export function savedImages(run: unknown): CollectorRow[] {
  const data = run as { jobs?: Record<string, { folder?: string; records?: any[] }> };
  return Object.values(data.jobs ?? {}).flatMap((job) =>
    (job.records ?? [])
      .filter((r) => r.status === 'saved' && typeof r.file_name === 'string' && r.file_name)
      .map((r) => ({
        ...r,
        saved_path: [job.folder ?? '', r.file_name].filter(Boolean).join('/'),
      })),
  );
}
export async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = COLLECTOR_TIMEOUT_MS,
  watch?: { authWaitMs?: number },
): Promise<{ code: number; output: string }> {
  const authWaitMs = watch?.authWaitMs ?? 0;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let output = '';
    let state = createCollectorWatch(Date.now(), timeoutMs, authWaitMs);
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      const delay = Math.max(0, collectorKillAt(state) - Date.now());
      timer = setTimeout(() => {
        child.kill();
        reject(Error(state.authStartedAt != null ? 'auth_wait_timeout' : 'collector_timeout'));
      }, delay);
    };
    arm();
    const append = (b: Buffer) => {
      const chunk = b.toString('utf8');
      output = (output + chunk).slice(-16000);
      const updated = noteCollectorOutput(state, chunk, Date.now());
      if (
        updated.authStartedAt !== state.authStartedAt ||
        updated.collectionDeadline !== state.collectionDeadline
      ) {
        state = updated;
        arm();
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(Error('python_unavailable:' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 2, output });
    });
  });
}
export async function collectImages(job: string, config: Config, slot?: string): Promise<void> {
  await acquireSlots(
    job,
    'download',
    async ({ sectionId, plan }, used, content) => {
      if (plan.mode !== 'download') throw Error('wrong_image_mode');
      if (plan.engine === 'direct') {
        const source = content.research.sources.find((s) => s.sourceId === plan.sourceId);
        if (!source || !webUrl(plan.imageUrl)) throw Error('image_source_missing');
        const response = await fetch(plan.imageUrl, { signal: AbortSignal.timeout(30000) });
        const mediaType = response.headers
          .get('content-type')
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase();
        if (
          !response.ok ||
          (!mediaType?.startsWith('image/') &&
            mediaType !== 'application/octet-stream' &&
            mediaType !== 'binary/octet-stream')
        )
          throw Error('image_response_invalid:' + response.status);
        const raw = Buffer.from(await response.arrayBuffer());
        if (raw.length > 30 * 1024 * 1024) throw Error('image_too_large');
        const bytes = await sharp(raw).rotate().png().toBuffer(),
          meta = await sharp(bytes).metadata();
        if (!meta.width || !meta.height) throw Error('image_decode_failed');
        if (used.has(sha256(bytes))) throw Error('duplicate_image:' + plan.slotId);
        const relativePath = `images/${plan.slotId}.png`;
        await writeFile(await safeFile(job, relativePath), bytes);
        return {
          assetId: plan.slotId,
          slotId: plan.slotId,
          sectionId,
          kind: 'download',
          relativePath,
          sha256: sha256(bytes),
          width: meta.width,
          height: meta.height,
          sourceUrl: source.url,
          originalUrl: response.url,
          requestedUrl: plan.imageUrl,
          acquiredAt: new Date().toISOString(),
          caption: plan.caption ?? '',
          query: plan.query,
          engine: plan.engine,
        };
      }
      const outputRoot = await safeFile(job, `receipts/collector-${plan.slotId}-${randomUUID()}`);
      await mkdir(outputRoot, { recursive: true });
      const google = plan.engine === 'google';
      if (google && new URL(config.googleCdpEndpoint).port === new URL(config.cdpEndpoint).port)
        throw Error('cdp_port_collision');
      const args = collectorArgs(
        plan.engine,
        plan.query,
        outputRoot,
        config.googleCdpEndpoint,
      );
      let result: { code: number; output: string };
      try {
        result = await runProcess(
          config.pythonPath,
          args,
          config.root,
          COLLECTOR_TIMEOUT_MS,
          { authWaitMs: google ? AUTH_WAIT_MS : 0 },
        );
      } catch (error) {
        const message = (error as Error).message;
        await writeFile(join(outputRoot, 'collector.log'), message, 'utf8');
        throw Error(`image_collection_failed:${plan.slotId}:${message}`);
      }
      await writeFile(join(outputRoot, 'collector.log'), result.output, 'utf8');
      const dirs = await readdir(outputRoot, { withFileTypes: true });
      let picked: { bytes: Buffer; row: CollectorRow; width: number; height: number } | undefined;
      for (const dir of dirs.filter((d) => d.isDirectory())) {
        const runRoot = await safeFile(outputRoot, dir.name);
        let data;
        try {
          data = await readJson(await safeFile(runRoot, 'run.json'));
        } catch {
          continue;
        }
        for (const row of savedImages(data)) {
          if (!webUrl(row.source_url)) continue;
          if (isDisallowedImageSource(row.source_url)) continue;
          let raw: Buffer;
          try {
            const source = await safeFile(runRoot, row.saved_path);
            raw = await readFile(source);
          } catch {
            continue;
          }
          let bytes: Buffer, meta;
          try {
            bytes = await sharp(raw).png().toBuffer();
            meta = await sharp(bytes).metadata();
          } catch {
            continue;
          }
          if (!meta.width || !meta.height || used.has(sha256(bytes))) continue;
          picked = { bytes, row, width: meta.width, height: meta.height };
          break;
        }
        if (picked) break;
      }
      if (!picked)
        throw Error(
          `image_collection_failed:${plan.slotId}:exit_${result.code}:` + result.output.slice(-500),
        );
      const relativePath = `images/${plan.slotId}.png`;
      await writeFile(await safeFile(job, relativePath), picked.bytes);
      return {
        assetId: plan.slotId,
        slotId: plan.slotId,
        sectionId,
        kind: 'download',
        relativePath,
        sha256: sha256(picked.bytes),
        width: picked.width,
        height: picked.height,
        sourceUrl: picked.row.source_url!,
        originalUrl:
          picked.row.download_kind === 'original'
            ? String(picked.row.downloaded_url ?? picked.row.original_url)
            : null,
        acquiredAt: new Date().toISOString(),
        caption: plan.caption ?? '',
        query: plan.query,
        engine: plan.engine,
      };
    },
    slot,
  );
}
