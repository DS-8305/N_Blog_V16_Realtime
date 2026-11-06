import { spawn } from 'node:child_process';
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
export function noteCollectorOutput(
  state: CollectorWatch,
  chunk: string,
  now: number,
): CollectorWatch {
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
    } else if (
      line.includes('NBLOG_AWAIT_USER') &&
      next.authStartedAt == null &&
      next.authWaitMs > 0
    ) {
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
    '5',
    '--output-dir',
    outputRoot,
    '--keyword-timeout',
    '35',
    ...(engine === 'google'
      ? [
          '--show-browser',
          '--cdp',
          debuggerAddress(googleCdpEndpoint),
          '--profile',
          'blog',
          '--download-mode',
          'original-preferred',
          '--min-width',
          '400',
          '--min-height',
          '400',
          '--min-long-edge',
          '800',
          '--max-candidates',
          '24',
          '--max-scrolls',
          '6',
        ]
      : ['--headless', '--download-mode', 'thumbnail']),
  ];
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
