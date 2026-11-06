import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { createCaptureContext } from '../src/capture/capture.js';

const browserTest = process.env.NBLOG_BROWSER_TESTS === '1' ? it : it.skip;

async function localSite() {
  const requests: string[] = [];
  const upgrades: string[] = [];
  const image = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
  const server = createServer((request, response) => {
    requests.push(`${request.headers.host}${request.url}`);
    response.setHeader('access-control-allow-origin', '*');
    if (request.url === '/allowed.png') {
      response.setHeader('content-type', 'image/png');
      response.end(image);
    } else if (request.url === '/redirect') {
      response.writeHead(302, {
        location: `http://media.cdninstagram.com:${port}/redirected-private`,
      });
      response.end();
    } else if (request.url === '/redirect-chain') {
      response.writeHead(302, { location: '/redirect' });
      response.end();
    } else if (request.url === '/redirect-allowed') {
      response.writeHead(302, { location: '/allowed.png' });
      response.end();
    } else if (request.url === '/redirect-article') {
      response.writeHead(302, { location: '/article' });
      response.end();
    } else if (request.url === '/sw.js') {
      response.setHeader('content-type', 'application/javascript');
      response.end(
        'self.addEventListener("fetch", event => event.respondWith(new Response("worker")));',
      );
    } else {
      response.setHeader('content-type', 'text/html');
      response.end(
        '<!doctype html><title>Public source</title><img id="photo" src="/allowed.png">',
      );
    }
  });
  server.on('upgrade', (request, socket) => {
    upgrades.push(`${request.headers.host}${request.url}`);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    requests,
    upgrades,
    base: `http://127.0.0.1:${port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function localBrowser(): Promise<Browser> {
  // Even a failing policy must never contact a real external host in these tests.
  return chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost'],
  });
}

browserTest(
  'aborts blocked fetch and XHR destinations before network while loading a publisher image',
  async () => {
    const site = await localSite();
    const browser = await localBrowser();
    try {
      const context = await createCaptureContext(browser, `${site.base}/article`);
      const page = await context.newPage();
      await page.goto(`${site.base}/article`);
      expect(
        await page.locator('#photo').evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBe(40);
      const blockedBase = `http://media.cdninstagram.com:${site.port}`;
      const results = await page.evaluate(async (base) => {
        const fetched = await fetch(`${base}/fetch-private`).then(
          () => 'loaded',
          () => 'blocked',
        );
        const xhr = await new Promise<string>((resolve) => {
          const request = new XMLHttpRequest();
          request.open('GET', `${base}/xhr-private`);
          request.onload = () => resolve('loaded');
          request.onerror = () => resolve('blocked');
          request.send();
        });
        return { fetched, xhr };
      }, blockedBase);
      expect(results).toEqual({ fetched: 'blocked', xhr: 'blocked' });
      expect(site.requests.some((request) => /fetch-private|xhr-private/.test(request))).toBe(
        false,
      );
      expect(site.requests.some((request) => request.endsWith('/allowed.png'))).toBe(true);
      await context.close();
    } finally {
      await browser.close();
      await site.close();
    }
  },
);

browserTest('checks navigation destinations separately from the publisher source', async () => {
  const site = await localSite();
  const browser = await localBrowser();
  try {
    const context = await createCaptureContext(browser, `${site.base}/article`);
    const page = await context.newPage();
    await page.goto(`${site.base}/article`);
    await expect(page.goto(`http://instagram.com:${site.port}/ordinary-account`)).rejects.toThrow();
    expect(site.requests.some((request) => request.includes('ordinary-account'))).toBe(false);
    await context.close();
  } finally {
    await browser.close();
    await site.close();
  }
});

browserTest(
  'uses a temporary cookie-isolated context with service workers blocked and preserves the existing context',
  async () => {
    const site = await localSite();
    const browser = await localBrowser();
    try {
      const existing = await browser.newContext();
      await existing.addCookies([{ name: 'session', value: 'existing-auth', url: site.base }]);
      const existingPage = await existing.newPage();
      await existingPage.goto(`${site.base}/article`);
      const context = await createCaptureContext(browser, `${site.base}/article`);
      const page = await context.newPage();
      await page.goto(`${site.base}/article`);
      expect(await page.evaluate(() => document.cookie)).toBe('');
      const registration = await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js').catch(() => {});
        return {
          active: (await navigator.serviceWorker.getRegistrations()).length,
          controlled: !!navigator.serviceWorker.controller,
        };
      });
      expect(registration).toEqual({ active: 0, controlled: false });
      expect(site.requests.some((request) => request.endsWith('/sw.js'))).toBe(false);
      await context.close();
      expect(browser.isConnected()).toBe(true);
      expect(existingPage.isClosed()).toBe(false);
      expect(await existingPage.evaluate(() => document.cookie)).toBe('session=existing-auth');
      expect(await existingPage.title()).toBe('Public source');
    } finally {
      await browser.close();
      await site.close();
    }
  },
);

browserTest('rejects blocked redirect destinations before they receive a request', async () => {
  const site = await localSite();
  const browser = await localBrowser();
  try {
    const context = await createCaptureContext(browser, `${site.base}/article`);
    const page = await context.newPage();
    await page.goto(`${site.base}/article`);
    const result = await page.evaluate(
      async (url) =>
        fetch(url).then(
          () => 'loaded',
          () => 'blocked',
        ),
      `${site.base}/redirect`,
    );
    expect(result).toBe('blocked');
    expect(site.requests.some((request) => request.endsWith('/redirected-private'))).toBe(false);
    await context.close();
  } finally {
    await browser.close();
    await site.close();
  }
});

browserTest('fails closed on redirect chains and requires canonical publisher URLs', async () => {
  const site = await localSite();
  const browser = await localBrowser();
  try {
    const context = await createCaptureContext(browser, `${site.base}/article`);
    const page = await context.newPage();
    await page.goto(`${site.base}/article`);
    const results = await page.evaluate(
      async (base) => ({
        private: await fetch(`${base}/redirect-chain`).then(
          () => 'loaded',
          () => 'blocked',
        ),
        publisher: await fetch(`${base}/redirect-allowed`).then(
          () => 'loaded',
          () => 'blocked',
        ),
      }),
      site.base,
    );
    expect(results).toEqual({ private: 'blocked', publisher: 'blocked' });
    expect(site.requests.some((request) => request.endsWith('/redirected-private'))).toBe(false);
    await expect(page.goto(`${site.base}/redirect-article`)).rejects.toThrow();
    await expect(page.goto(`${site.base}/redirect-chain`)).rejects.toThrow();
    expect(site.requests.some((request) => request.endsWith('/redirected-private'))).toBe(false);
    await context.close();
  } finally {
    await browser.close();
    await site.close();
  }
});

browserTest('blocks websocket upgrades in public capture contexts before network', async () => {
  const site = await localSite();
  const browser = await localBrowser();
  try {
    const unguarded = await browser.newContext();
    const control = await unguarded.newPage();
    await control.goto(`${site.base}/article`);
    await control.evaluate(
      (url) =>
        new Promise<void>((resolve) => {
          const socket = new WebSocket(url);
          socket.onerror = socket.onclose = () => resolve();
        }),
      `ws://127.0.0.1:${site.port}/control`,
    );
    expect(site.upgrades).toHaveLength(1);
    site.upgrades.length = 0;
    await unguarded.close();
    const context = await createCaptureContext(browser, `${site.base}/article`);
    const page = await context.newPage();
    await page.goto(`${site.base}/article`);
    const results = await page.evaluate(
      async (urls) =>
        Promise.all(
          urls.map(
            (url) =>
              new Promise<string>((resolve) => {
                const socket = new WebSocket(url);
                socket.onopen = () => {
                  socket.close();
                  resolve('opened');
                };
                socket.onerror = socket.onclose = () => resolve('blocked');
              }),
          ),
        ),
      [
        `ws://127.0.0.1:${site.port}/publisher-live`,
        `ws://media.cdninstagram.com:${site.port}/private-live`,
      ],
    );
    expect(results).toEqual(['blocked', 'blocked']);
    expect(site.upgrades).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
    await site.close();
  }
});
