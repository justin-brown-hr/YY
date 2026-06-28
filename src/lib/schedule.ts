/** Wait until HH:MM:SS today (or tomorrow if passed). "rn" = no wait. */

export function parseScheduleTime(raw: string): Date | null {
  if (!raw || raw.toLowerCase() === 'rn') return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, min, sec, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target;
}

export function msUntil(target: Date): number {
  return Math.max(0, target.getTime() - Date.now());
}

export async function waitUntil(target: Date, signal?: AbortSignal): Promise<void> {
  let left = msUntil(target);
  while (left > 0) {
    if (signal?.aborted) throw new Error('Stopped');
    const sleep = left > 500 ? 50 : left;
    await new Promise((r) => setTimeout(r, sleep));
    left = msUntil(target);
  }
}

/** Spin-wait last ~200ms for drop-time accuracy */
export async function waitUntilHighPrecision(target: Date, signal?: AbortSignal): Promise<void> {
  const coarse = msUntil(target) - 200;
  if (coarse > 0) await waitUntil(new Date(Date.now() + coarse), signal);
  while (Date.now() < target.getTime()) {
    if (signal?.aborted) throw new Error('Stopped');
  }
}

/** nudTimeLoginBefore: when to start login before schedule */
export function loginStartTime(scheduleTarget: Date, loginBeforeMinutes: number): Date {
  return new Date(scheduleTarget.getTime() - loginBeforeMinutes * 60_000);
}
