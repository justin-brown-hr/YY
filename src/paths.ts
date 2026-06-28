import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Project root (yodo-fast/) */
export const projectRoot = join(__dirname, '..');

/** Same layout as YodoTool: AutoBuy/handle.jsc next to tmpData.json */
export function resolveAutoBuyDir(): string {
  const candidates = [
    join(projectRoot, 'AutoBuy'),
    join(projectRoot, '..', 'YodoTool', 'AutoBuy'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'handle.jsc'))) return dir;
  }
  return candidates[0];
}

export function tmpDataPath(): string {
  return join(projectRoot, 'tmpData.json');
}

export function handleJscPath(autoBuyDir: string): string {
  return join(autoBuyDir, 'handle.jsc');
}
