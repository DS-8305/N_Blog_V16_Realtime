import { resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { optionalJson } from './state/files.js';
import type { Config, Conditions } from './domain/types.js';
import editorialRules from '../config/editorial-rules.json' with { type: 'json' };
export const defaults: Conditions = { ...editorialRules.conditions };
export function normalizeEndpoint(value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    !u.port
  )
    throw Error('local_cdp_required');
  return u.origin;
}
export function assertDedicatedChromeProfile(profilePath: string) {
  const norm = profilePath.replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/google/chrome/user data')) throw Error('chrome_default_profile_forbidden');
}
export function validateConditions(value: Conditions): Conditions {
  for (const n of Object.values(value)) {
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 1) throw Error('invalid_conditions');
  }
  const minSec = value.sectionMin ?? value.sectionCount;
  const maxSec = value.sectionMax ?? value.sectionCount;
  if (!minSec || !maxSec || minSec > maxSec || minSec < 1 || maxSec > 30)
    throw Error('invalid_conditions');
  if (
    value.sectionCount < minSec ||
    value.sectionCount > maxSec ||
    (value.imageMax !== undefined && value.sectionCount * value.imagesPerSection > value.imageMax)
  )
    throw Error('invalid_conditions');
  if (
    value.bodyMax < value.bodyMin ||
    value.bodyMax > 20000 ||
    value.bodyMin < 1 ||
    (value.imageMin !== undefined &&
      value.imageMax !== undefined &&
      value.imageMin > value.imageMax) ||
    (value.imagesPerSection !== undefined && value.imagesPerSection > 30)
  )
    throw Error('invalid_conditions');
  return value;
}
export function defaultPython(root: string): string {
  const candidates = [resolve(root, '.venv/Scripts/python.exe'), resolve(root, '.venv/bin/python')];
  return candidates.find(existsSync) ?? process.env.NBLOG_PYTHON ?? 'python';
}
export async function resolveConfig(
  options: Record<string, unknown> = {},
  root = process.cwd(),
): Promise<Config> {
  const file = options.config
    ? resolve(root, String(options.config))
    : resolve(root, 'nblog.config.json');
  const saved = (await optionalJson<Partial<Config>>(file)) ?? {};
  const rawConditions = { ...saved.conditions } as Record<string, unknown>;
  if (typeof rawConditions.sectionCount === 'string') {
    const parts = (rawConditions.sectionCount as string).split(/[~-]/).map((s) => Number(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      rawConditions.sectionMin = parts[0];
      rawConditions.sectionMax = parts[1];
      rawConditions.sectionCount = parts[0];
    }
  }
  if (typeof rawConditions.imageCount === 'string') {
    const parts = (rawConditions.imageCount as string)
      .replace(/[^0-9~-]/g, '')
      .split(/[~-]/)
      .map((s) => Number(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      rawConditions.imageMin = parts[0];
      rawConditions.imageMax = parts[1];
    }
  }
  const conditions = validateConditions({
    ...defaults,
    ...rawConditions,
    ...(options.bodyMin ? { bodyMin: Number(options.bodyMin) } : {}),
    ...(options.bodyMax ? { bodyMax: Number(options.bodyMax) } : {}),
    ...(options.imagesPerSection ? { imagesPerSection: Number(options.imagesPerSection) } : {}),
  });
  const blogId = String(options.blogId ?? saved.blogId ?? '');
  if (blogId && !/^[a-zA-Z0-9_-]+$/.test(blogId)) throw Error('invalid_blog_id');
  const cdpEndpoint = normalizeEndpoint(
    String(options.cdp ?? saved.cdpEndpoint ?? 'http://127.0.0.1:9225'),
  );
  const googleCdpEndpoint = normalizeEndpoint(
    String(options.googleCdp ?? saved.googleCdpEndpoint ?? 'http://127.0.0.1:9230'),
  );
  const profilePath = resolve(
    root,
    String(options.profile ?? saved.profilePath ?? '.runtime/chrome-profile'),
  );
  const googleProfilePath = resolve(
    root,
    String(options.googleProfile ?? saved.googleProfilePath ?? '.runtime/chrome-google-profile'),
  );
  if (new URL(cdpEndpoint).port === new URL(googleCdpEndpoint).port)
    throw Error('cdp_port_collision');
  if (profilePath === googleProfilePath) throw Error('chrome_profile_collision');
  assertDedicatedChromeProfile(profilePath);
  assertDedicatedChromeProfile(googleProfilePath);
  return {
    root: resolve(root),
    cdpEndpoint,
    profilePath,
    googleCdpEndpoint,
    googleProfilePath,
    workspaceRoot: resolve(root, String(options.workspace ?? saved.workspaceRoot ?? 'workspaces')),
    blogId,
    pythonPath: String(options.python ?? saved.pythonPath ?? defaultPython(root)),
    conditions,
  };
}
