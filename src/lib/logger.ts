import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEvent, LogLevel } from '../types.js';

type Listener = (event: LogEvent) => void;

const listeners = new Set<Listener>();
let logFilePath: string | null = null;
const logBuffer: LogEvent[] = [];
const LOG_BUFFER_MAX = 500;

export function getRecentLogs(limit = 200): LogEvent[] {
  return logBuffer.slice(-limit);
}

export function initFileLogger(logDir: string): void {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const seq = String(Date.now()).slice(-3);
  logFilePath = join(logDir, `log${stamp}_${seq}.txt`);
  appendFileSync(logFilePath, `${formatTs()} [INF] Application started\n`);
}

export function onLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function formatTs(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const m = String(Math.abs(off) % 60).padStart(2, '0');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')} ${sign}${h}:${m}`;
}

export function emitLog(
  taskId: string,
  email: string,
  level: LogLevel,
  message: string,
  step?: string,
): void {
  const event: LogEvent = { taskId, email, level, message, step, ts: Date.now() };
  logBuffer.push(event);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  for (const l of listeners) l(event);
  const prefix = step ? `[${step}]` : '';
  const line = `${formatTs()} [INF] ${email} ${prefix} ${message}`;
  console.log(line);
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line + '\n');
    } catch {
      /* ignore */
    }
  }
}

export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
