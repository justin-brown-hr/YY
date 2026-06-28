import { connect } from 'puppeteer-real-browser';
import type { Browser } from 'rebrowser-puppeteer-core';
import { API, BASE_WWW } from '../constants/api.js';
import { isLoggedInHtml } from '../lib/html.js';
import type { Account, ProxyConfig } from '../types.js';
import { YodoSession, importPuppeteerCookies } from './session.js';

const MAX_BROWSER_PARALLEL = 3;
let activeBrowsers = 0;
const waitQueue: (() => void)[] = [];

async function acquireBrowserSlot(): Promise<void> {
  if (activeBrowsers < MAX_BROWSER_PARALLEL) {
    activeBrowsers++;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeBrowsers++;
}

function releaseBrowserSlot(): void {
  activeBrowsers--;
  const next = waitQueue.shift();
  if (next) next();
}

export interface BrowserLoginResult {
  ok: boolean;
  error?: string;
}

/** Browser login — same stack as YodoTool (puppeteer-real-browser + Akamai bypass) */
export async function browserLogin(
  session: YodoSession,
  account: Account,
  proxy?: ProxyConfig,
): Promise<BrowserLoginResult> {
  await acquireBrowserSlot();
  let browser: Browser | undefined;
  try {
    const { browser: b, page } = await connect({
      headless: true,
      turnstile: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-http2',
      ],
      connectOption: { defaultViewport: { width: 1280, height: 800 } },
      proxy: proxy
        ? {
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
          }
        : undefined,
    });
    browser = b;

    await page.goto(BASE_WWW + '/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.goto(API.memberIndex, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    const memberHtml = await page.content();
    if (!isLoggedInHtml(memberHtml)) {
      await page.goto(API.login, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.waitForSelector('input[name="loginId"]', { timeout: 30_000 });

      await page.click('input[name="loginId"]', { clickCount: 3 });
      await page.type('input[name="loginId"]', account.email, { delay: 25 });
      await page.click('input[name="password"]', { clickCount: 3 });
      await page.type('input[name="password"]', account.password, { delay: 25 });

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {}),
        page
          .click('button[type="submit"], input[type="submit"], .loginBtn, #doLogin')
          .catch(() => page.keyboard.press('Enter')),
      ]);
    }

    const cookies = await page.cookies();
    await importPuppeteerCookies(session.jar, cookies);
    await browser.close();
    browser = undefined;

    const member = await session.get(API.memberIndex);
    const ok = isLoggedInHtml(member.data);
    return { ok, error: ok ? undefined : 'browser login failed — session not logged in' };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    releaseBrowserSlot();
  }
}
