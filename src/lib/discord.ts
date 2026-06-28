import axios from 'axios';
import type { RunSummary, TaskState } from '../types.js';
import { emitLog } from './logger.js';

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
}

/** Same pattern as YodoTool: RestSharp POST webhook with embeds JSON */
export async function sendDiscordWebhook(
  webhookUrl: string,
  embed: DiscordEmbed,
): Promise<boolean> {
  try {
    const res = await axios.post(
      webhookUrl,
      { embeds: [embed] },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 },
    );
    return res.status >= 200 && res.status < 300;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitLog('discord', 'discord', 'error', `Discord webhook failed: ${msg}`);
    return false;
  }
}

export async function reportTaskResult(
  webhookUrl: string | undefined,
  task: TaskState,
): Promise<void> {
  if (!webhookUrl) return;
  const ok = task.success === true;
  const embed: DiscordEmbed = {
    title: ok ? '✅ Buy Success' : '❌ Buy Failed',
    color: ok ? 0x22c55e : 0xef4444,
    fields: [
      { name: 'Account', value: task.account.email, inline: true },
      { name: 'Product', value: task.productId, inline: true },
      { name: 'Amount', value: String(task.amount), inline: true },
      { name: 'Status', value: task.status, inline: true },
      { name: 'Login', value: task.loginMs != null ? `${task.loginMs}ms` : '-', inline: true },
      { name: 'Buy', value: task.buyMs != null ? `${task.buyMs}ms` : '-', inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
  if (task.message) embed.fields.push({ name: 'Error', value: task.message.slice(0, 500) });
  await sendDiscordWebhook(webhookUrl, embed);
}

export async function reportRunSummary(
  webhookUrl: string | undefined,
  summary: RunSummary,
): Promise<void> {
  if (!webhookUrl) return;
  const embed: DiscordEmbed = {
    title: '📊 Run Summary',
    color: summary.failed === 0 ? 0x22c55e : summary.success > 0 ? 0xf59e0b : 0xef4444,
    description: `Product: **${summary.productId}** | Schedule: **${summary.scheduleTime}**`,
    fields: [
      { name: 'Total', value: String(summary.total), inline: true },
      { name: 'Success', value: String(summary.success), inline: true },
      { name: 'Failed', value: String(summary.failed), inline: true },
      {
        name: 'Duration',
        value: `${((summary.finishedAt - summary.startedAt) / 1000).toFixed(1)}s`,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };
  if (summary.successAccounts.length) {
    embed.fields.push({
      name: '✅ Success accounts',
      value: summary.successAccounts.slice(0, 20).join('\n').slice(0, 1000),
    });
  }
  if (summary.failAccounts.length) {
    embed.fields.push({
      name: '❌ Failed accounts',
      value: summary.failAccounts.slice(0, 20).join('\n').slice(0, 1000),
    });
  }
  await sendDiscordWebhook(webhookUrl, embed);
}
