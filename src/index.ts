import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initFileLogger } from './lib/logger.js';
import { startServer } from './server/app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
initFileLogger(join(root, 'log'));

const port = Number(process.env.PORT) || 3847;
startServer(port);
