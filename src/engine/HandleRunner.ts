import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { emitLog } from '../lib/logger.js';
import { toLegacyTmpData } from '../lib/config.js';
import { handleJscPath, resolveAutoBuyDir, tmpDataPath } from '../paths.js';
import type { Account, ProxyConfig, TaskConfig } from '../types.js';

/** Serialize tmpData writes — handle.jsc reads ../tmpData.json from AutoBuy cwd */
let tmpDataLock: Promise<void> = Promise.resolve();

function withTmpDataLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tmpDataLock.then(fn, fn);
  tmpDataLock = run.then(
    () => {},
    () => {},
  );
  return run;
}

function accountLine(account: Account): string {
  return `${account.email} ${account.password} ${account.cardNumber} ${account.cardMonth} ${account.cardYear} ${account.cvv}`;
}

function proxyLabel(proxy?: ProxyConfig): string {
  if (!proxy) return 'noproxy';
  return `${proxy.host}:${proxy.port}:${proxy.username ?? ''}:${proxy.password ?? ''}`;
}

export interface HandleRunOptions {
  taskId: string;
  account: Account;
  config: TaskConfig;
  proxy?: ProxyConfig;
  scheduleTime: string;
  signal?: AbortSignal;
  onStep?: (step: string) => void;
}

export interface HandleRunResult {
  ok: boolean;
  error?: string;
}

/** Parse handle.jsc stdout — same lines as YodoAutoApp logs */
function parseLine(
  line: string,
  email: string,
  onStep?: (step: string) => void,
): boolean | undefined {
  const t = line.trim();
  if (!t) return undefined;

  if (t.includes('login success')) onStep?.('login');
  if (t.includes('start buy')) onStep?.('buying');
  if (t.includes('callApiAddCart')) onStep?.('callApiAddCart');
  if (t.includes('buy success') && t.includes('true')) return true;
  if (t.includes('success:false') || (t.includes('buy success') && t.includes('false'))) return false;
  if (t.includes('login fail')) return false;

  return undefined;
}

/**
 * Run one account through original YodoTool handle.jsc (unchanged buy workflow).
 * Writes tmpData.json then spawns: node -r bytenode handle.jsc
 */
export async function runHandle(opts: HandleRunOptions): Promise<HandleRunResult> {
  const { taskId, account, config, proxy, scheduleTime, signal, onStep } = opts;
  const email = account.email;
  const autoBuyDir = resolveAutoBuyDir();
  const jsc = handleJscPath(autoBuyDir);

  const line = accountLine(account);
  const proxyStr = proxyLabel(proxy);
  const timeStr = scheduleTime || 'rn';

  const taskConfig: TaskConfig = {
    ...config,
    accounts: [account],
    proxy,
    scheduleTime: timeStr,
  };

  return withTmpDataLock(async () => {
    writeFileSync(tmpDataPath(), JSON.stringify(toLegacyTmpData(taskConfig), null, 2), 'utf8');

    emitLog(taskId, email, 'info', `engine → handle.jsc (${proxyStr})`, 'engine');

    return new Promise<HandleRunResult>((resolve) => {
      if (signal?.aborted) {
        resolve({ ok: false, error: 'Stopped' });
        return;
      }

      const child = spawn(
        process.platform === 'win32' ? 'node.exe' : 'node',
        ['-r', 'bytenode', jsc, line, proxyStr, timeStr, String(config.amount), config.productId],
        {
          cwd: autoBuyDir,
          env: process.env,
          windowsHide: true,
        },
      );

      let stdout = '';
      let stderr = '';
      let result: boolean | undefined;

      const abort = () => {
        child.kill('SIGTERM');
        resolve({ ok: false, error: 'Stopped' });
      };
      signal?.addEventListener('abort', abort, { once: true });

      child.stdout.on('data', (buf: Buffer) => {
        const text = buf.toString();
        stdout += text;
        for (const raw of text.split(/\r?\n/)) {
          const parsed = parseLine(raw, email, onStep);
          if (parsed !== undefined) result = parsed;
          if (raw.trim()) emitLog(taskId, email, 'info', raw.trim());
        }
      });

      child.stderr.on('data', (buf: Buffer) => {
        stderr += buf.toString();
        for (const raw of buf.toString().split(/\r?\n/)) {
          if (raw.trim()) emitLog(taskId, email, 'error', raw.trim());
        }
      });

      child.on('error', (err) => {
        signal?.removeEventListener('abort', abort);
        resolve({ ok: false, error: err.message });
      });

      child.on('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (result === true) {
          resolve({ ok: true });
          return;
        }
        if (result === false) {
          resolve({ ok: false, error: 'handle.jsc reported failure' });
          return;
        }
        if (stdout.includes('buy success') && stdout.includes('true')) {
          resolve({ ok: true });
          return;
        }
        const errMsg =
          stderr.trim() ||
          (code !== 0 ? `handle.jsc exited ${code}` : 'No success signal from handle.jsc');
        resolve({ ok: false, error: errMsg });
      });
    });
  });
}

export function checkEngine(): { ok: boolean; path: string; error?: string } {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      path: resolveAutoBuyDir(),
      error: 'handle.jsc only runs on Windows (use YodoTool on Windows, not Linux)',
    };
  }
  const dir = resolveAutoBuyDir();
  const jsc = join(dir, 'handle.jsc');
  if (!existsSync(jsc)) {
    return {
      ok: false,
      path: dir,
      error: 'Copy AutoBuy/ from YodoTool into yodo-fast/AutoBuy (need handle.jsc + node_modules)',
    };
  }
  return { ok: true, path: dir };
}
