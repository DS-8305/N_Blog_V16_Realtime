import { mkdir, open, realpath, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
export function normalizeEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    !['', '/'].includes(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error('loopback_cdp_required');
  url.hostname = '127.0.0.1';
  url.pathname = '';
  return url.origin;
}
export function defaultProfilePath(): string {
  return join(
    process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
    'n-blog-auto-vnext',
    'browser-profile',
  );
}
export async function acquireJobLock(jobPath: string): Promise<() => Promise<void>> {
  return acquire(join(await realpath(jobPath), 'draft-run.lock'));
}
async function acquire(path: string): Promise<() => Promise<void>> {
  const token = randomUUID();
  let handle;
  try {
    handle = await open(path, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      try {
        const data = JSON.parse(await readFile(path, 'utf8'));
        let alive = false;
        if (data?.pid) {
          try {
            process.kill(data.pid, 0);
            alive = true;
          } catch {
            alive = false;
          }
        }
        if (!alive) {
          await unlink(path).catch(() => {});
          handle = await open(path, 'wx');
        } else {
          throw new Error('session_locked:' + path);
        }
      } catch (inner) {
        if ((inner as Error).message.startsWith('session_locked:')) throw inner;
        throw new Error('session_locked:' + path);
      }
    } else {
      throw error;
    }
  }
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }),
    );
  } catch (error) {
    await handle.close();
    await unlink(path);
    throw error;
  }
  await handle.close();
  let released = false;
  return async () => {
    if (released) return;
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.token !== token) throw new Error('lock_owner_changed');
    await unlink(path);
    released = true;
  };
}
export async function acquireBrowserLocks(
  endpoint: string,
  profilePath: string,
  lockRoot = join(
    process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
    'N_Blog_V10_Budong',
    'locks',
  ),
): Promise<() => Promise<void>> {
  const normalized = normalizeEndpoint(endpoint);
  await mkdir(lockRoot, { recursive: true });
  await mkdir(profilePath, { recursive: true });
  const profile = await realpath(profilePath);
  const endpointRelease = await acquire(
    join(lockRoot, createHash('sha256').update(normalized).digest('hex') + '.lock'),
  );
  let profileRelease;
  try {
    profileRelease = await acquire(join(profile, 'nblog-automation.lock'));
  } catch (error) {
    await endpointRelease();
    throw error;
  }
  return async () => {
    try {
      await profileRelease();
    } finally {
      await endpointRelease();
    }
  };
}
