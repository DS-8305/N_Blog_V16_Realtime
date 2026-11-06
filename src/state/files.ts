import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, realpath, stat, open, unlink } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute, sep } from 'node:path';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const fingerprint = (value: unknown) => sha256(JSON.stringify(canonical(value)));
export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as T;
}
export async function optionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return await readJson<T>(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  try {
    await rename(temp, path);
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
}
function inside(root: string, target: string): boolean {
  const r = relative(root, target);
  return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r));
}
export async function safeFile(root: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || path.includes('\0')) throw Error('path_outside_job');
  const base = await realpath(root),
    target = resolve(base, path);
  if (!inside(base, target)) throw Error('path_outside_job');
  let existing = target;
  while (true) {
    try {
      const actual = await realpath(existing);
      if (!inside(base, actual)) throw Error('path_outside_job');
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      const parent = dirname(existing);
      if (parent === existing) throw e;
      existing = parent;
    }
  }
  return target;
}
export async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}
export async function acquireLock(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await open(path, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      const held = await optionalJson<{ pid?: number; token: string }>(path);
      let alive = false;
      if (held?.pid) {
        try {
          process.kill(held.pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (!alive) {
        await unlink(path).catch(() => {});
        handle = await open(path, 'wx');
      } else {
        throw Error('locked:' + path);
      }
    } else {
      throw e;
    }
  }
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }),
    );
  } finally {
    await handle.close();
  }
  return async () => {
    const held = await optionalJson<{ token: string }>(path);
    if (held?.token === token) await unlink(path);
  };
}
