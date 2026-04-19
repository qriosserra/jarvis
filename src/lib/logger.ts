import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino, { type TransportTargetOptions } from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CONSOLE_ENABLED = (process.env.LOG_CONSOLE_ENABLED ?? 'true') === 'true';
const FILE_ENABLED = (process.env.LOG_FILE_ENABLED ?? 'false') === 'true';
const FILE_PATH = process.env.LOG_FILE_PATH ?? './logs/app.log';
const STDOUT_FD = 1;
const TRANSPORT_EXTENSION = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const PRETTY_TRANSPORT_PATH = fileURLToPath(
  new URL(`./logger-transport${TRANSPORT_EXTENSION}`, import.meta.url),
);

const rootLogger = createRootLogger();

function createRootLogger(): pino.Logger {
  const targets = buildTransportTargets();
  if (targets.length === 0) {
    return pino({ level: 'silent' });
  }
  return pino({
    level: LOG_LEVEL,
    transport: { targets },
  });
}

function buildTransportTargets(): TransportTargetOptions[] {
  const targets: TransportTargetOptions[] = [];
  if (CONSOLE_ENABLED) {
    targets.push(buildConsoleTarget());
  }
  if (FILE_ENABLED) {
    targets.push(buildFileTarget());
  }
  return targets;
}

function buildConsoleTarget(): TransportTargetOptions {
  if (IS_PRODUCTION) {
    return {
      target: 'pino/file',
      level: LOG_LEVEL,
      options: { destination: STDOUT_FD },
    };
  }
  return {
    target: PRETTY_TRANSPORT_PATH,
    level: LOG_LEVEL,
    options: {
      colorize: true,
      ignore: 'pid,hostname,module',
      destination: STDOUT_FD,
    },
  };
}

function buildFileTarget(): TransportTargetOptions {
  const absoluteFilePath = resolve(FILE_PATH);
  mkdirSync(dirname(absoluteFilePath), { recursive: true });
  if (!IS_PRODUCTION) {
    return {
      target: PRETTY_TRANSPORT_PATH,
      level: LOG_LEVEL,
      options: {
        colorize: false,
        ignore: 'pid,hostname,module',
        destination: absoluteFilePath,
        sync: true,
      },
    };
  }
  return {
    target: 'pino/file',
    level: LOG_LEVEL,
    options: { destination: absoluteFilePath, mkdir: true, sync: true },
  };
}

export function createLogger(name: string): pino.Logger {
  return rootLogger.child({ module: name });
}

export { rootLogger };

/**
 * Capture the source location of the calling site.
 *
 * Uses `new Error().stack` (frame at depth 2) to extract the file path
 * and line number.  The project root is stripped so the result is a
 * compact relative path.  The caller supplies `functionName` because it
 * cannot be reliably inferred from callbacks or arrow functions.
 *
 * Example: `captureCallSite('interpretIntent')` →
 *          `"src/conversation/interpret.ts:73 interpretIntent"`
 */
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/');

export function captureCallSite(functionName: string): string {
  const stack = new Error().stack ?? '';
  // Frame 0 = Error, 1 = captureCallSite, 2 = direct caller
  const frame = stack.split('\n')[2] ?? '';
  const match = frame.match(/(?:at\s+.*?\(|at\s+)(.*?):(\d+):\d+\)?/);
  if (match) {
    const filePath = match[1].replace(/\\/g, '/').replace(PROJECT_ROOT, '');
    return `${filePath}:${match[2]} ${functionName}`;
  }
  return functionName;
}
