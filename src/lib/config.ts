import { readFileSync } from 'node:fs';
import type { LegacyTmpData, ProxyConfig, TaskConfig, Account, WorkflowFlags, AppSettings } from '../types.js';

export const DEFAULT_FLAGS: WorkflowFlags = {
  USE_OLD_CARD: false,
  HAVE_SAVE_CARD: true,
  NOT_ONLY_USE_PROXY_CONFIRM: false,
  IS_RUN_SLOW: false,
  TIME_CHECK_PRODUCT_AVAILABLE: false,
  TIME_WAIT: 0,
};

export const DEFAULT_SETTINGS: AppSettings = {
  maxTab: 100,
  allowPaymentShop: true,
  version: '1.0.0-fast',
};

export function parseAccountLine(line: string): Account | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const [email, password, cardNumber, cardMonth, cardYear, cvv] = parts;
  return { email, password, cardNumber, cardMonth, cardYear, cvv };
}

export function parseProxy(raw?: string): ProxyConfig | undefined {
  if (!raw || raw === 'noproxy') return undefined;
  const parts = raw.split(':');
  if (parts.length < 2) return undefined;
  const [host, portStr, username, password] = parts;
  const port = Number(portStr);
  if (!host || !port) return undefined;
  return { host, port, username, password };
}

/** One proxy per line — round-robin across accounts */
export function parseProxyList(text: string): ProxyConfig[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => parseProxy(l))
    .filter((p): p is ProxyConfig => p !== undefined);
}

export function extractProductId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/(\d{10,})/);
  return m?.[1] ?? trimmed;
}

export function fromLegacyTmpData(data: LegacyTmpData, extra?: Partial<TaskConfig>): TaskConfig {
  const accounts = data.List_0.map(parseAccountLine).filter((a): a is Account => a !== null);
  return {
    productId: extractProductId(data.String_0),
    productLink: data.String_0,
    accounts,
    proxy: parseProxy(data.String_1),
    scheduleTime: data.String_2 || 'rn',
    loginBeforeMinutes: extra?.loginBeforeMinutes ?? 2,
    amount: data.Nullable_0 ?? 1,
    maxParallel: extra?.maxParallel ?? DEFAULT_SETTINGS.maxTab,
    discordWebhookUrl: extra?.discordWebhookUrl,
    fingerprint: extra?.fingerprint,
    saveCard: extra?.saveCard ?? true,
    flags: { ...DEFAULT_FLAGS, ...extra?.flags },
    settings: { ...DEFAULT_SETTINGS, ...extra?.settings },
  };
}

export function toLegacyTmpData(config: TaskConfig): LegacyTmpData {
  const proxy = config.proxy;
  const proxyStr = proxy
    ? `${proxy.host}:${proxy.port}:${proxy.username ?? ''}:${proxy.password ?? ''}`
    : '';
  return {
    String_0: config.productLink || config.productId,
    List_0: config.accounts.map(
      (a) => `${a.email} ${a.password} ${a.cardNumber} ${a.cardMonth} ${a.cardYear} ${a.cvv}`,
    ),
    String_1: proxyStr,
    String_2: config.scheduleTime,
    Nullable_0: config.amount,
  };
}

export function loadConfigFromFile(path: string): TaskConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as LegacyTmpData | TaskConfig;
  if ('String_0' in raw) return fromLegacyTmpData(raw);
  return {
    ...raw,
    flags: { ...DEFAULT_FLAGS, ...raw.flags },
    settings: { ...DEFAULT_SETTINGS, ...raw.settings },
  };
}

export function defaultConfig(): TaskConfig {
  return {
    productId: '',
    accounts: [],
    scheduleTime: 'rn',
    loginBeforeMinutes: 2,
    amount: 1,
    maxParallel: 10,
    saveCard: true,
    flags: { ...DEFAULT_FLAGS },
    settings: { ...DEFAULT_SETTINGS },
  };
}
