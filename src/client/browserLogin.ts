import { connect } from 'puppeteer-real-browser';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser } from 'rebrowser-puppeteer-core';
import { API } from '../constants/api.js';
import { isLoggedInHtml } from '../lib/html.js';
import { emitLog } from '../lib/logger.js';
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

export interface BrowserLoginOptions {
  session: YodoSession;
  account: Account;
  proxy?: ProxyConfig;
  taskId?: string;
}

/** Browser login — puppeteer-real-browser + stealth (same stack as YodoTool) */
export async function browserLogin(opts: BrowserLoginOptions): Promise<BrowserLoginResult> {
  const { session, account, proxy, taskId = 'browser' } = opts;
  const log = (msg: string, level: 'info' | 'error' = 'info') =>
    emitLog(taskId, account.email, level, msg, 'browser');

  await acquireBrowserSlot();
  let browser: Browser | undefined;
  try {
    log('Launching Chrome (visible window — do not close it)...');
    const { browser: b, page } = await connect({
      // YodoTool default: visible browser — headless:true often hangs on Akamai
      headless: false,
      turnstile: true,
      plugins: [StealthPlugin()],
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

    const nav = async (url: string, label: string, timeout = 60_000) => {
      log(`Navigating: ${label}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      log(`${label} loaded (${page.url().slice(0, 80)})`);
    };

    await nav(API.login, 'login page');

    let html = await page.content();
    if (isLoggedInHtml(html)) {
      log('Already logged in');
    } else {
      await page.waitForSelector('input[name="loginId"]', { timeout: 30_000 });
      log('Filling credentials...');

      await page.click('input[name="loginId"]', { clickCount: 3 });
      await page.type('input[name="loginId"]', account.email, { delay: 30 });
      await page.click('input[name="password"]', { clickCount: 3 });
      await page.type('input[name="password"]', account.password, { delay: 30 });

      log('Submitting login...');
      const submit =
        'button[type="submit"], input[type="submit"], .loginBtn, #doLogin, a.loginBtn';
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}),
        page.realClick
          ? page.realClick(submit).catch(() => page.click(submit))
          : page.click(submit),
      ]);
      html = await page.content();
      if (!isLoggedInHtml(html) && !page.url().includes('mypage')) {
        await nav(API.memberIndex, 'member page', 45_000);
        html = await page.content();
      }
    }

    const cookies = await page.cookies();
    log(`Got ${cookies.length} cookies — syncing to session`);
    await importPuppeteerCookies(session.jar, cookies);
    await browser.close();
    browser = undefined;

    const member = await session.get(API.memberIndex);
    const ok = isLoggedInHtml(member.data);
    return { ok, error: ok ? undefined : 'browser login failed — session not logged in' };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    log(`Browser error: ${msg}`, 'error');
    return { ok: false, error: msg };
  } finally {
    releaseBrowserSlot();
  }
}
