import { randomUUID } from 'node:crypto';
import { BuyWorkflow } from '../workflow/BuyWorkflow.js';
import { parseProxyList } from '../lib/config.js';
import { emitLog } from '../lib/logger.js';
import { reportRunSummary, reportTaskResult } from '../lib/discord.js';
import {
  loginStartTime,
  parseScheduleTime,
  waitUntil,
  waitUntilHighPrecision,
} from '../lib/schedule.js';
import type { RunSummary, TaskConfig, TaskState } from '../types.js';

export class Orchestrator {
  private tasks = new Map<string, TaskState>();
  private running = false;
  private abort?: AbortController;
  private lastSummary: RunSummary | null = null;

  getTasks(): TaskState[] {
    return [...this.tasks.values()];
  }

  getSummary(): RunSummary | null {
    return this.lastSummary;
  }

  isRunning(): boolean {
    return this.running;
  }

  loadConfig(config: TaskConfig, proxyText?: string): TaskState[] {
    this.tasks.clear();
    const proxies = proxyText ? parseProxyList(proxyText) : config.proxy ? [config.proxy] : [];
    const created: TaskState[] = [];
    config.accounts.forEach((account, i) => {
      const id = randomUUID();
      const state: TaskState = {
        id,
        account,
        proxy: proxies.length ? proxies[i % proxies.length] : undefined,
        productId: config.productId,
        amount: config.amount,
        scheduleTime: config.scheduleTime,
        status: 'pending',
      };
      this.tasks.set(id, state);
      created.push(state);
    });
    return created;
  }

  async start(config: TaskConfig, proxyText?: string): Promise<RunSummary> {
    if (this.running) throw new Error('Already running');
    this.running = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const runStartedAt = Date.now();

    const states = this.loadConfig(config, proxyText);
    const valid = states.length;
    emitLog('system', 'system', 'info', `Có ${valid} hàng hợp lệ`);

    const buyTarget = parseScheduleTime(config.scheduleTime);
    if (buyTarget) {
      emitLog('system', 'system', 'info', `-- Đặt lịch: ${valid}`);
      emitLog('system', 'system', 'info', `-- Time to run: ${msUntilLabel(buyTarget)}`);
      emitLog('system', 'system', 'info', `-- Start run at: ${config.scheduleTime}, delay: 0 ms`);
    } else {
      emitLog('system', 'system', 'info', `-- Start run now: ${valid}`);
    }

    const limit = Math.min(config.maxParallel, config.settings.maxTab, valid);
    const queue = [...states];
    const workers = Array.from({ length: limit }, async () => {
      while (queue.length > 0) {
        if (signal.aborted) break;
        const task = queue.shift();
        if (!task) break;
        await this.runTask(task, config, buyTarget, signal);
      }
    });
    await Promise.all(workers);

    const all = [...this.tasks.values()];
    const summary: RunSummary = {
      total: valid,
      success: all.filter((t) => t.success).length,
      failed: all.filter((t) => !t.success).length,
      successAccounts: all.filter((t) => t.success).map((t) => t.account.email),
      failAccounts: all.filter((t) => !t.success).map((t) => t.account.email),
      startedAt: runStartedAt,
      finishedAt: Date.now(),
      productId: config.productId,
      scheduleTime: config.scheduleTime,
    };
    this.lastSummary = summary;

    this.running = false;
    emitLog('system', 'system', 'info', `-- End run now: ${valid}`);
    emitLog(
      'system',
      'system',
      'info',
      `success:${summary.success} failed:${summary.failed}`,
    );

    await reportRunSummary(config.discordWebhookUrl, summary);
    return summary;
  }

  private async runTask(
    task: TaskState,
    config: TaskConfig,
    buyTarget: Date | null,
    signal: AbortSignal,
  ): Promise<void> {
    const { account, productId, amount, proxy } = task;
    const proxyLabel = proxy
      ? `${proxy.host}:${proxy.port}:${proxy.username ?? ''}:${proxy.password ?? ''}`
      : 'noproxy';
    const timeLabel = buyTarget ? task.scheduleTime : 'rn';
    emitLog(
      task.id,
      account.email,
      'info',
      `Account info: ${account.email} ${account.password} ${account.cardNumber} ${account.cardMonth} ${account.cardYear} ${account.cvv}, Proxy: ${proxyLabel}, Time: ${timeLabel}, Amount: ${amount}`,
    );

    task.status = 'pending';
    task.startedAt = Date.now();

    const wf = new BuyWorkflow({
      taskId: task.id,
      account,
      productId,
      amount,
      proxy,
      flags: config.flags,
      saveCard: config.saveCard,
      fingerprint: config.fingerprint,
      signal,
      onStep: (step) => {
        task.currentStep = step;
      },
    });

    try {
      // nudTimeLoginBefore: wait until login window if scheduled
      if (buyTarget && config.loginBeforeMinutes > 0) {
        const loginAt = loginStartTime(buyTarget, config.loginBeforeMinutes);
        if (Date.now() < loginAt.getTime()) {
          task.status = 'waiting';
          emitLog(task.id, account.email, 'info', `wait login until ${fmt(loginAt)}`);
          await waitUntil(loginAt, signal);
        }
      }

      task.status = 'pre-login';
      const loginStart = Date.now();
      const loggedIn = await wf.runLoginPhase();
      task.loginAt = Date.now();
      task.loginMs = task.loginAt - loginStart;

      if (!loggedIn) {
        task.status = 'failed';
        task.success = false;
        task.finishedAt = Date.now();
        task.totalMs = task.finishedAt - task.startedAt!;
        return;
      }

      if (buyTarget) {
        task.status = 'waiting';
        await waitUntilHighPrecision(buyTarget, signal);
      }

      task.status = 'buying';
      const buyStart = Date.now();
      task.buyAt = buyStart;
      const success = await wf.runBuyPhase();
      task.buyMs = Date.now() - buyStart;
      task.status = success ? 'success' : 'failed';
      task.success = success;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Stopped') {
        task.status = 'stopped';
      } else {
        emitLog(task.id, account.email, 'error', `error run ${account.email}: ${msg}`);
        task.status = 'failed';
        task.success = false;
        task.message = msg;
      }
    } finally {
      task.finishedAt = Date.now();
      if (task.startedAt) task.totalMs = task.finishedAt - task.startedAt;
      if (task.status !== 'stopped' && task.success) {
        await reportTaskResult(config.discordWebhookUrl, task);
      }
    }
  }

  stop(): void {
    this.abort?.abort();
    this.running = false;
    emitLog('system', 'system', 'info', 'Stop requested');
  }
}

function msUntilLabel(target: Date): string {
  const ms = Math.max(0, target.getTime() - Date.now());
  return `${ms} ms`;
}

function fmt(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export const orchestrator = new Orchestrator();
