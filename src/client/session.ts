import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { CookieJar } from 'tough-cookie';
import { emitLog } from '../lib/logger.js';
import type { ProxyConfig } from '../types.js';

export interface PuppeteerCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
}

/** Copy browser cookies into axios session jar */
export async function importPuppeteerCookies(jar: CookieJar, cookies: PuppeteerCookie[]): Promise<void> {
  for (const c of cookies) {
    const domain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    const url = `https://${domain}${c.path || '/'}`;
    const parts = [`${c.name}=${c.value}`, `Domain=${c.domain}`, `Path=${c.path || '/'}`];
    if (c.secure) parts.push('Secure');
    await jar.setCookie(parts.join('; '), url);
  }
}

const TIMEOUT_NO_PROXY = 45_000;
const TIMEOUT_WITH_PROXY = 60_000;
const PROBE_TIMEOUT = 20_000;
const MAX_RETRIES = 2;

function proxyUrl(p: ProxyConfig): string {
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@` : '';
  return `http://${auth}${p.host}:${p.port}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const code = err.code ?? '';
  const msg = err.message ?? '';
  return (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    msg.includes('timeout')
  );
}

export class YodoSession {
  readonly jar = new CookieJar();
  readonly client: AxiosInstance;
  readonly proxy?: ProxyConfig;
  readonly timeoutMs: number;

  constructor(proxy?: ProxyConfig) {
    this.proxy = proxy;
    this.timeoutMs = proxy ? TIMEOUT_WITH_PROXY : TIMEOUT_NO_PROXY;
    const agent = proxy
      ? new HttpsProxyAgent(proxyUrl(proxy), {
          timeout: this.timeoutMs,
          keepAlive: true,
        })
      : undefined;
    this.client = axios.create({
      timeout: this.timeoutMs,
      maxRedirects: 10,
      validateStatus: () => true,
      httpAgent: agent,
      httpsAgent: agent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        Connection: 'keep-alive',
      },
    });
    this.client.interceptors.request.use(async (config) => {
      const url = config.url ?? '';
      const cookie = await this.jar.getCookieString(url);
      if (cookie) {
        config.headers = config.headers ?? {};
        config.headers.Cookie = cookie;
      }
      return config;
    });
    this.client.interceptors.response.use(async (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie && res.config.url) {
        for (const c of Array.isArray(setCookie) ? setCookie : [setCookie]) {
          await this.jar.setCookie(c, res.config.url);
        }
      }
      return res;
    });
  }

  private async withRetry<T>(step: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          emitLog('http', 'http', 'info', `${step} — retry ${attempt}/${MAX_RETRIES}`);
        }
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt === MAX_RETRIES) break;
        await sleep(1000 * attempt);
      }
    }
    const msg = axios.isAxiosError(lastErr)
      ? `${lastErr.message}${lastErr.code ? ` (${lastErr.code})` : ''}`
      : lastErr instanceof Error
        ? lastErr.message
        : String(lastErr);
    throw new Error(`${step}: ${msg}`);
  }

  async get(url: string, config?: AxiosRequestConfig) {
    return this.withRetry(`GET ${shortUrl(url)}`, () =>
      this.client.get<string>(url, {
        ...config,
        timeout: config?.timeout ?? this.timeoutMs,
        responseType: 'text',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...config?.headers,
        },
      }),
    );
  }

  async post(
    url: string,
    body: string | URLSearchParams | Record<string, string>,
    config?: AxiosRequestConfig,
  ) {
    const data =
      body instanceof URLSearchParams
        ? body.toString()
        : typeof body === 'string'
          ? body
          : new URLSearchParams(body).toString();
    return this.withRetry(`POST ${shortUrl(url)}`, () =>
      this.client.post<string>(url, data, {
        ...config,
        timeout: config?.timeout ?? this.timeoutMs,
        responseType: 'text',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...config?.headers,
        },
      }),
    );
  }

  async postJson(url: string, body: unknown, config?: AxiosRequestConfig) {
    return this.withRetry(`POST ${shortUrl(url)}`, () =>
      this.client.post<string>(url, body, {
        ...config,
        timeout: config?.timeout ?? this.timeoutMs,
        responseType: 'text',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...config?.headers },
      }),
    );
  }

  location(res: {
    headers: Record<string, unknown>;
    request?: { res?: { responseUrl?: string } };
  }): string | undefined {
    const loc = res.headers['location'];
    if (typeof loc === 'string') return loc;
    return res.request?.res?.responseUrl;
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.length > 40 ? u.pathname.slice(0, 40) + '…' : u.pathname;
  } catch {
    return url.slice(0, 40);
  }
}

/** Quick probe — single attempt, 20s max (fail fast) */
export async function probeYodobashi(
  proxy?: ProxyConfig,
): Promise<{ ok: boolean; error?: string; ms?: number }> {
  const agent = proxy
    ? new HttpsProxyAgent(proxyUrl(proxy), { timeout: PROBE_TIMEOUT })
    : undefined;
  const url = 'https://order.yodobashi.com/yc/login/index.html';
  const t0 = Date.now();
  try {
    const res = await axios.get<string>(url, {
      timeout: PROBE_TIMEOUT,
      httpsAgent: agent,
      httpAgent: agent,
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'text',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const ms = Date.now() - t0;
    if (res.status >= 500) return { ok: false, error: `HTTP ${res.status}`, ms };
    if (!res.data || res.data.length < 100) return { ok: false, error: 'empty response', ms };
    return { ok: true, ms };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

/** Test proxy reachability (same as YodoTool checkProxy) */
export async function testProxy(proxy: ProxyConfig): Promise<{ ok: boolean; ip?: string; error?: string }> {
  try {
    const agent = new HttpsProxyAgent(proxyUrl(proxy), { timeout: PROBE_TIMEOUT });
    const res = await axios.get<string>('https://api.ipify.org/?format=txt', {
      timeout: PROBE_TIMEOUT,
      httpsAgent: agent,
      httpAgent: agent,
      validateStatus: () => true,
      responseType: 'text',
    });
    if (res.status >= 400) return { ok: false, error: `HTTP ${res.status}` };
    const ip = res.data.trim();
    return { ok: !!ip, ip };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
