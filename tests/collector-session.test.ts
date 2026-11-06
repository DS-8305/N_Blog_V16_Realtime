import { it, expect, afterEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture } from './helpers.js';
import { atomicJson } from '../src/state/files.js';
import { resolveConfig } from '../src/config.js';
import {
  AUTH_WAIT_MS,
  COLLECTOR_TIMEOUT_MS,
  collectorArgs,
  collectorKillAt,
  collectImages,
  createCollectorWatch,
  noteCollectorOutput,
  runProcess,
} from '../src/images/collect.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

it('keeps the Naver collector command headless and off the Google CDP port', () => {
  const args = collectorArgs('naver', '행사 사진', '/tmp/out', 'http://127.0.0.1:9230');
  expect(args).toContain('--headless');
  expect(args).not.toContain('--cdp');
  expect(args).not.toContain('--show-browser');
  expect(args).toContain('thumbnail');
});

it('attaches Google collection to the visible loopback session', () => {
  const args = collectorArgs('google', '인물 현장', '/tmp/out', 'http://127.0.0.1:9230');
  expect(args).toContain('--show-browser');
  expect(args).toContain('--cdp');
  expect(args).toContain('127.0.0.1:9230');
  expect(args).not.toContain('--headless');
  expect(args).toContain('original-preferred');
});

it('pauses the 240s collector kill timer only during the 600s user check', () => {
  const start = 1_000;
  let state = createCollectorWatch(start, COLLECTOR_TIMEOUT_MS, AUTH_WAIT_MS);
  expect(collectorKillAt(state)).toBe(start + COLLECTOR_TIMEOUT_MS);
  state = noteCollectorOutput(state, 'NBLOG_AWAIT_USER\n', start + 20_000);
  expect(collectorKillAt(state)).toBe(start + 20_000 + AUTH_WAIT_MS);
  state = noteCollectorOutput(state, 'NBLOG_AWAIT_USER_DONE\n', start + 20_000 + 500_000);
  expect(state.authStartedAt).toBeNull();
  expect(collectorKillAt(state)).toBe(start + COLLECTOR_TIMEOUT_MS + 500_000);
});

it('does not extend a Naver process that never waits for a user', () => {
  const state = noteCollectorOutput(
    createCollectorWatch(0, COLLECTOR_TIMEOUT_MS, 0),
    'NBLOG_AWAIT_USER\n',
    10,
  );
  expect(state.authStartedAt).toBeNull();
  expect(collectorKillAt(state)).toBe(COLLECTOR_TIMEOUT_MS);
});

it('lets a user-check marker outlive the original process timeout', async () => {
  const result = await runProcess(
    process.execPath,
    [
      '-e',
      "process.stdout.write('NBLOG_AWAIT_USER\\n'); setTimeout(() => { process.stdout.write('NBLOG_AWAIT_USER_DONE\\n'); process.exit(0); }, 1200);",
    ],
    process.cwd(),
    400,
    { authWaitMs: 2000 },
  );
  expect(result.code).toBe(0);
  await expect(
    runProcess(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(0), 900)'],
      process.cwd(),
      300,
    ),
  ).rejects.toThrow('collector_timeout');
});

it('records a failed Google search round without replacing images already on disk', async () => {
  const f = await fixture();
  roots.push(f.root);
  const module = join(f.root, 'image_collector');
  await mkdir(module);
  await writeFile(
    join(module, '__main__.py'),
    'print("offline collector failure")\nraise SystemExit(2)\n',
  );
  const python = process.platform === 'win32' ? resolve('.venv/Scripts/python.exe') : 'python3';
  const plan = f.post.sections[0].images[0];
  if (plan.mode !== 'download') throw Error('fixture must use a download plan');
  plan.query += ' revised scene';
  await atomicJson(join(f.job, 'post.json'), f.post);
  const imagePath = join(f.job, f.assets[0].relativePath);
  const before = await readFile(imagePath);
  await expect(collectImages(f.job, { ...f.config, pythonPath: python }, 's1-1')).rejects.toThrow(
    'image_collection_failed:exit_2',
  );
  expect(await readFile(imagePath)).toEqual(before);
  const pool = JSON.parse(await readFile(join(f.job, 'receipts/image-candidates.json'), 'utf8'));
  expect(pool.queries[0].status).toBe('failed');
  expect(pool.queries[0].error).toContain('exit_2');
});

it('rejects a Google CDP port that collides with the Naver editor port', async () => {
  const f = await fixture();
  roots.push(f.root);
  await expect(
    resolveConfig({ blogId: 'test-blog', cdp: 'http://127.0.0.1:9230' }, f.root),
  ).rejects.toThrow('cdp_port_collision');
  await expect(
    resolveConfig({ blogId: 'test-blog', googleProfile: '.runtime/chrome-profile' }, f.root),
  ).rejects.toThrow('chrome_profile_collision');
});
