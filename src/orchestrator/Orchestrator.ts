import { randomUUID } from 'node:crypto';
import { runHandle } from '../engine/HandleRunner.js';
import { parseProxyList } from '../lib/config.js';
import { emitLog } from '../lib/logger.js';
import { reportRunSummary, reportTaskResult } from '../lib/discord.js';
import { loginStartTime, parseScheduleTime, waitUntil } from '../lib/schedule.js';
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

    try {
      const states = this.loadConfig(config, proxyText);
      const valid = states.length;
      if (valid === 0) {
        emitLog('system', 'system', 'error', 'No valid accounts — format: email password card month year cvv');
        return {
          total: 0,
          success: 0,
          failed: 0,
          successAccounts: [],
          failAccounts: [],
          startedAt: runStartedAt,
          finishedAt: Date.now(),
          productId: config.productId,
          scheduleTime: config.scheduleTime,
        };
      }

      emitLog('system', 'system', 'info', `${valid} valid account(s)`);

      const buyTarget = parseScheduleTime(config.scheduleTime);
      if (buyTarget) {
        emitLog('system', 'system', 'info', `Scheduled run: ${valid} account(s)`);
        emitLog('system', 'system', 'info', `Buy time: ${config.scheduleTime}`);
      } else {
        emitLog('system', 'system', 'info', `Run now: ${valid} account(s)`);
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

      emitLog('system', 'system', 'info', `Finished: ${valid} account(s)`);
      emitLog('system', 'system', 'info', `success:${summary.success} failed:${summary.failed}`);

      await reportRunSummary(config.discordWebhookUrl, summary);
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async runTask(
    task: TaskState,
    config: TaskConfig,
    buyTarget: Date | null,
    signal: AbortSignal,
  ): Promise<void> {
    const { account, amount, proxy } = task;
    const proxyLabel = proxy
      ? `${proxy.host}:${proxy.port}:${proxy.username ?? ''}:${proxy.password ?? ''}`
      : 'noproxy';
    const timeLabel = buyTarget ? task.scheduleTime : 'rn';

    emitLog(
      task.id,
      account.email,
      'info',
      `Account: ${account.email}, Proxy: ${proxyLabel}, Time: ${timeLabel}, Amount: ${amount}`,
    );

    task.status = 'pending';
    task.startedAt = Date.now();

    try {
      if (buyTarget && config.loginBeforeMinutes > 0) {
        const spawnAt = loginStartTime(buyTarget, config.loginBeforeMinutes);
        if (Date.now() < spawnAt.getTime()) {
          task.status = 'waiting';
          emitLog(task.id, account.email, 'info', `Wait until ${fmt(spawnAt)} to start engine`);
          await waitUntil(spawnAt, signal);
        }
      }

      task.status = 'running';
      const t0 = Date.now();

      const result = await runHandle({
        taskId: task.id,
        account,
        config,
        proxy,
        scheduleTime: timeLabel,
        signal,
        onStep: (step) => {
          task.currentStep = step;
        },
      });

      task.totalMs = Date.now() - t0;
      task.success = result.ok;
      task.status = result.ok ? 'success' : 'failed';
      if (!result.ok) task.message = result.error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Stopped') {
        task.status = 'stopped';
      } else {
        emitLog(task.id, account.email, 'error', `error: ${msg}`);
        task.status = 'failed';
        task.success = false;
        task.message = msg;
      }
    } finally {
      task.finishedAt = Date.now();
      if (task.startedAt && !task.totalMs) task.totalMs = task.finishedAt - task.startedAt;
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

function fmt(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export const orchestrator = new Orchestrator();
