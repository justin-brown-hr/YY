import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
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
const dbPath = join(root, 'data', 'yodo-fast.db');

export interface WorkspaceData {
  config: TaskConfig;
  accountsText: string;
  proxyText: string;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initSchema(db);
    migrateFromFiles(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      accounts_text TEXT NOT NULL DEFAULT '',
      proxy_text TEXT NOT NULL DEFAULT '',
      product_link TEXT NOT NULL DEFAULT '',
      schedule_time TEXT NOT NULL DEFAULT 'rn',
      login_before_minutes INTEGER NOT NULL DEFAULT 2,
      amount INTEGER NOT NULL DEFAULT 1,
      max_parallel INTEGER NOT NULL DEFAULT 100,
      discord_webhook TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL DEFAULT '',
      save_card INTEGER NOT NULL DEFAULT 1,
      scan_enabled INTEGER NOT NULL DEFAULT 0,
      flags_json TEXT NOT NULL DEFAULT '{}',
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const row = database.prepare('SELECT id FROM workspace WHERE id = 1').get();
  if (!row) {
    database.prepare(`
      INSERT INTO workspace (id) VALUES (1)
    `).run();
  }
}

function migrateFromFiles(database: Database.Database): void {
  const current = database.prepare('SELECT accounts_text, proxy_text, discord_webhook FROM workspace WHERE id = 1').get() as {
    accounts_text: string;
    proxy_text: string;
    discord_webhook: string;
  };

  if (current.accounts_text || current.proxy_text || current.discord_webhook) return;

  const configPath = join(root, 'data/config.json');
  const legacyPath = join(root, 'data/tmpData.json');
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

    saveWorkspace({
      accountsText,
      proxyText,
      config,
    });
  } catch {
    /* ignore bad migration */
  }
}

export function loadWorkspace(): WorkspaceData {
  const row = getDb().prepare('SELECT * FROM workspace WHERE id = 1').get() as Record<string, unknown>;
  const flags = { ...DEFAULT_FLAGS, ...JSON.parse(String(row.flags_json || '{}')) };
  const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(String(row.settings_json || '{}')) };

  const accountsText = String(row.accounts_text ?? '');
  const proxyText = String(row.proxy_text ?? '');
  const accounts = accountsText
    .split('\n')
    .map((l) => parseAccountLine(l))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const firstProxyLine = proxyText.split('\n').map((l) => l.trim()).find(Boolean);
  const proxy = firstProxyLine ? parseProxy(firstProxyLine) : undefined;

  const productLink = String(row.product_link ?? '');

  const config: TaskConfig = {
    productId: extractProductId(productLink),
    productLink,
    accounts,
    proxy,
    scheduleTime: String(row.schedule_time ?? 'rn'),
    loginBeforeMinutes: Number(row.login_before_minutes ?? 2),
    amount: Number(row.amount ?? 1),
    maxParallel: Number(row.max_parallel ?? 100),
    discordWebhookUrl: String(row.discord_webhook ?? ''),
    fingerprint: String(row.fingerprint ?? ''),
    saveCard: Number(row.save_card ?? 1) === 1,
    flags: {
      ...flags,
      TIME_CHECK_PRODUCT_AVAILABLE: Number(row.scan_enabled ?? 0) === 1,
    },
    settings,
  };

  return { config, accountsText, proxyText };
}

export function saveWorkspace(data: {
  accountsText: string;
  proxyText: string;
  config: TaskConfig;
}): void {
  const { accountsText, proxyText, config } = data;
  getDb()
    .prepare(
      `
    UPDATE workspace SET
      accounts_text = ?,
      proxy_text = ?,
      product_link = ?,
      schedule_time = ?,
      login_before_minutes = ?,
      amount = ?,
      max_parallel = ?,
      discord_webhook = ?,
      fingerprint = ?,
      save_card = ?,
      scan_enabled = ?,
      flags_json = ?,
      settings_json = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `,
    )
    .run(
      accountsText,
      proxyText,
      config.productLink || config.productId,
      config.scheduleTime,
      config.loginBeforeMinutes,
      config.amount,
      config.maxParallel,
      config.discordWebhookUrl ?? '',
      config.fingerprint ?? '',
      config.saveCard ? 1 : 0,
      config.flags.TIME_CHECK_PRODUCT_AVAILABLE ? 1 : 0,
      JSON.stringify(config.flags),
      JSON.stringify(config.settings),
    );
}

export function getUpdatedAt(): string | null {
  const row = getDb().prepare('SELECT updated_at FROM workspace WHERE id = 1').get() as
    | { updated_at: string }
    | undefined;
  return row?.updated_at ?? null;
}
