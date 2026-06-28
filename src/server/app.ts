import express from 'express';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { orchestrator } from '../orchestrator/Orchestrator.js';
import { checkEngine } from '../engine/HandleRunner.js';
import { loadWorkspace, saveWorkspace, getUpdatedAt } from '../db/store.js';
import {
  extractProductId,
  parseAccountLine,
  parseProxy,
  DEFAULT_FLAGS,
  DEFAULT_SETTINGS,
  defaultConfig,
} from '../lib/config.js';
import { onLog, getRecentLogs } from '../lib/logger.js';
import type { TaskConfig } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const publicDir = join(root, 'public');

function bodyToConfig(body: Record<string, unknown>): {
  config: TaskConfig;
  accountsText: string;
  proxyText: string;
} {
  const base = loadWorkspace();
  const accountsText = typeof body.accountLines === 'string' ? body.accountLines : base.accountsText;
  const proxyText = typeof body.proxyRaw === 'string' ? body.proxyRaw : base.proxyText;

  const accounts = accountsText
    .split('\n')
    .map((l) => parseAccountLine(l))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const firstProxyLine = proxyText.split('\n').map((l) => l.trim()).find(Boolean);
  const proxy = body.proxy
    ? (body.proxy as TaskConfig['proxy'])
    : firstProxyLine
      ? parseProxy(firstProxyLine)
      : undefined;

  const productInput = String(body.productLink ?? body.productId ?? base.config.productLink ?? '');

  const config: TaskConfig = {
    ...defaultConfig(),
    ...base.config,
    productId: extractProductId(productInput),
    productLink: productInput,
    accounts,
    proxy,
    scheduleTime: String(body.scheduleTime ?? base.config.scheduleTime ?? 'rn'),
    loginBeforeMinutes: Number(body.loginBeforeMinutes ?? base.config.loginBeforeMinutes ?? 2),
    amount: Number(body.amount ?? base.config.amount ?? 1),
    maxParallel: Number(body.maxParallel ?? base.config.maxParallel ?? 100),
    discordWebhookUrl: String(body.discordWebhookUrl ?? base.config.discordWebhookUrl ?? ''),
    fingerprint: String(body.fingerprint ?? base.config.fingerprint ?? ''),
    saveCard: body.saveCard !== undefined ? Boolean(body.saveCard) : base.config.saveCard,
    flags: { ...DEFAULT_FLAGS, ...base.config.flags, ...(body.flags as object) },
    settings: {
      ...DEFAULT_SETTINGS,
      ...base.config.settings,
      ...(body.settings as object),
    },
  };

  return { config, accountsText, proxyText };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(publicDir));

  app.get('/api/config', (_req, res) => {
    const { config, accountsText, proxyText } = loadWorkspace();
    const engine = checkEngine();
    res.json({
      ...config,
      accountLines: accountsText,
      proxyText,
      savedAt: getUpdatedAt(),
      engineOk: engine.ok,
      enginePath: engine.path,
      engineError: engine.error,
    });
  });

  app.post('/api/config', (req, res) => {
    const { config, accountsText, proxyText } = bodyToConfig(req.body);
    saveWorkspace({ config, accountsText, proxyText });
    res.json({
      ok: true,
      validRows: config.accounts.length,
      savedAt: getUpdatedAt(),
    });
  });

  app.post('/api/run', async (_req, res) => {
    if (orchestrator.isRunning()) {
      res.status(409).json({ error: 'Already running' });
      return;
    }
    const { config, proxyText } = loadWorkspace();
    const engine = checkEngine();
    if (!engine.ok) {
      res.status(400).json({ error: engine.error ?? 'YodoTool AutoBuy engine not found' });
      return;
    }
    if (!config.productId || config.accounts.length === 0) {
      res.status(400).json({ error: 'productId and accounts required' });
      return;
    }
    if (!config.settings.allowPaymentShop) {
      res.status(400).json({ error: 'AllowPaymentShop is disabled' });
      return;
    }
    res.json({ ok: true, tasks: config.accounts.length });
    orchestrator.start(config, proxyText).catch((e) => console.error(e));
  });

  app.post('/api/stop', (_req, res) => {
    orchestrator.stop();
    res.json({ ok: true });
  });

  app.get('/api/tasks', (_req, res) => {
    res.json(orchestrator.getTasks());
  });

  app.get('/api/summary', (_req, res) => {
    res.json(orchestrator.getSummary());
  });

  app.get('/api/logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    res.json(getRecentLogs(limit));
  });

  app.get('/api/running', (_req, res) => {
    res.json({ running: orchestrator.isRunning() });
  });

  return app;
}

export function startServer(port = 3847) {
  const app = createApp();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  onLog((event) => {
    const msg = JSON.stringify(event);
    for (const c of clients) {
      if (c.readyState === 1) c.send(msg);
    }
  });

  loadWorkspace();

  server.listen(port, () => {
    console.log(`yodo-fast UI: http://localhost:${port}`);
    console.log(`Database: ${join(root, 'data/yodo-fast.db')}`);
  });
}
