import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FLAGS,
  DEFAULT_SETTINGS,
  defaultConfig,
  extractProductId,
  fromLegacyTmpData,
  parseAccountLine,
  parseProxy,
} from '../lib/config.js';
import type { LegacyTmpData, TaskConfig } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const dataDir = join(root, 'data');
const storePath = join(dataDir, 'workspace.json');

export interface WorkspaceData {
  config: TaskConfig;
  accountsText: string;
  proxyText: string;
}

interface StoredWorkspace {
  accountsText: string;
  proxyText: string;
  productLink: string;
  scheduleTime: string;
  loginBeforeMinutes: number;
  amount: number;
  maxParallel: number;
  discordWebhookUrl: string;
  fingerprint: string;
  saveCard: boolean;
  flags: TaskConfig['flags'];
  settings: TaskConfig['settings'];
  updatedAt: string;
}

function defaultStored(): StoredWorkspace {
  const c = defaultConfig();
  return {
    accountsText: '',
    proxyText: '',
    productLink: '',
    scheduleTime: c.scheduleTime,
    loginBeforeMinutes: c.loginBeforeMinutes,
    amount: c.amount,
    maxParallel: c.maxParallel,
    discordWebhookUrl: '',
    fingerprint: '',
    saveCard: c.saveCard,
    flags: { ...DEFAULT_FLAGS },
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: new Date().toISOString(),
  };
}

function readStore(): StoredWorkspace {
  if (!existsSync(storePath)) {
    migrateFromLegacy();
  }
  if (!existsSync(storePath)) {
    return defaultStored();
  }
  try {
    return { ...defaultStored(), ...JSON.parse(readFileSync(storePath, 'utf8')) };
  } catch {
    return defaultStored();
  }
}

function writeStore(data: StoredWorkspace): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

function migrateFromLegacy(): void {
  const configPath = join(dataDir, 'config.json');
  const legacyPath = join(dataDir, 'tmpData.json');
  const path = existsSync(configPath) ? configPath : existsSync(legacyPath) ? legacyPath : null;
  if (!path) return;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as LegacyTmpData | TaskConfig;
    const config = 'String_0' in raw ? fromLegacyTmpData(raw) : { ...defaultConfig(), ...raw };
    const accountsText = config.accounts
      .map((a) => [a.email, a.password, a.cardNumber, a.cardMonth, a.cardYear, a.cvv].join(' '))
      .join('\n');
    const proxyText = config.proxy
      ? `${config.proxy.host}:${config.proxy.port}:${config.proxy.username ?? ''}:${config.proxy.password ?? ''}`
      : '';
    saveWorkspace({ accountsText, proxyText, config });
  } catch {
    /* ignore */
  }
}

function storedToWorkspace(row: StoredWorkspace): WorkspaceData {
  const accountsText = row.accountsText;
  const proxyText = row.proxyText;
  const accounts = accountsText
    .split('\n')
    .map((l) => parseAccountLine(l))
    .filter((a): a is NonNullable<typeof a> => a !== null);
  const firstProxyLine = proxyText.split('\n').map((l) => l.trim()).find(Boolean);
  const proxy = firstProxyLine ? parseProxy(firstProxyLine) : undefined;
  const productLink = row.productLink;

  const config: TaskConfig = {
    productId: extractProductId(productLink),
    productLink,
    accounts,
    proxy,
    scheduleTime: row.scheduleTime,
    loginBeforeMinutes: row.loginBeforeMinutes,
    amount: row.amount,
    maxParallel: row.maxParallel,
    discordWebhookUrl: row.discordWebhookUrl,
    fingerprint: row.fingerprint,
    saveCard: row.saveCard,
    flags: { ...DEFAULT_FLAGS, ...row.flags },
    settings: { ...DEFAULT_SETTINGS, ...row.settings },
  };

  return { config, accountsText, proxyText };
}

export function loadWorkspace(): WorkspaceData {
  return storedToWorkspace(readStore());
}

export function saveWorkspace(data: {
  accountsText: string;
  proxyText: string;
  config: TaskConfig;
}): void {
  const { accountsText, proxyText, config } = data;
  const prev = readStore();
  writeStore({
    accountsText,
    proxyText,
    productLink: config.productLink || config.productId,
    scheduleTime: config.scheduleTime,
    loginBeforeMinutes: config.loginBeforeMinutes,
    amount: config.amount,
    maxParallel: config.maxParallel,
    discordWebhookUrl: config.discordWebhookUrl ?? '',
    fingerprint: config.fingerprint ?? '',
    saveCard: config.saveCard,
    flags: config.flags,
    settings: config.settings,
    updatedAt: new Date().toISOString(),
  });
  void prev;
}

export function getUpdatedAt(): string | null {
  return readStore().updatedAt;
}
