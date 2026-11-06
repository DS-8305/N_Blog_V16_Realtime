import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { Config } from '../domain/types.js';
import { assertDedicatedChromeProfile } from '../config.js';
import { connectBrowser } from './session.js';
export function findChrome(): string | undefined {
  const candidates = [
    process.env.NBLOG_CHROME_PATH,
    join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(
      process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
      'Google/Chrome/Application/chrome.exe',
    ),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ];
  return candidates.find((p): p is string => Boolean(p && existsSync(p)));
}
export async function browserAvailableAt(endpoint: string): Promise<boolean> {
  try {
    const r = await fetch(endpoint + '/json/version', {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}
export async function browserAvailable(config: Config): Promise<boolean> {
  return browserAvailableAt(config.cdpEndpoint);
}
export async function launchChrome(config: Config) {
  if (await browserAvailable(config)) {
    const session = await connectBrowser(config);
    await session.release();
    return {
      status: 'chrome_ready',
      cdpEndpoint: config.cdpEndpoint,
      profilePath: config.profilePath,
    };
  }
  const chrome = findChrome();
  if (!chrome) throw Error('needs_user:chrome_not_found');
  await mkdir(config.profilePath, { recursive: true });
  const port = new URL(config.cdpEndpoint).port;
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${config.profilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      'https://nid.naver.com/nidlogin.login',
    ],
    { detached: true, stdio: 'ignore', windowsHide: false },
  );
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return {
    status: 'chrome_started',
    cdpEndpoint: config.cdpEndpoint,
    profilePath: config.profilePath,
    message: '전용 Chrome에서 네이버에 직접 로그인하세요.',
  };
}
export async function launchGoogleChrome(config: Config) {
  if (new URL(config.googleCdpEndpoint).port === new URL(config.cdpEndpoint).port)
    throw Error('cdp_port_collision');
  if (config.googleProfilePath === config.profilePath) throw Error('chrome_profile_collision');
  assertDedicatedChromeProfile(config.googleProfilePath);
  if (await browserAvailableAt(config.googleCdpEndpoint)) {
    return {
      status: 'chrome_ready',
      cdpEndpoint: config.googleCdpEndpoint,
      profilePath: config.googleProfilePath,
      message: '구글 이미지용 Chrome이 이미 열려 있습니다. 이 창은 닫지 마세요.',
    };
  }
  const chrome = findChrome();
  if (!chrome) throw Error('needs_user:chrome_not_found');
  await mkdir(config.googleProfilePath, { recursive: true });
  const port = new URL(config.googleCdpEndpoint).port;
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${config.googleProfilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      'https://www.google.com/',
    ],
    { detached: true, stdio: 'ignore', windowsHide: false },
  );
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return {
    status: 'chrome_started',
    cdpEndpoint: config.googleCdpEndpoint,
    profilePath: config.googleProfilePath,
    message: '구글 이미지용 Chrome에서 필요한 경우 직접 로그인하세요. 네이버 작성용 9225 창과는 별개입니다.',
  };
}
