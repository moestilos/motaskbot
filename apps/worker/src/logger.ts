const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function fmt(level: Level, scope: string, msg: string, meta?: unknown) {
  const metaStr = meta === undefined ? '' : ' ' + (typeof meta === 'string' ? meta : JSON.stringify(meta));
  return `[${ts()}] ${level.toUpperCase().padEnd(5)} ${scope} · ${msg}${metaStr}`;
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, meta?: unknown) => console.log(fmt('debug', scope, m, meta)),
    info: (m: string, meta?: unknown) => console.log(fmt('info', scope, m, meta)),
    warn: (m: string, meta?: unknown) => console.warn(fmt('warn', scope, m, meta)),
    error: (m: string, meta?: unknown) => console.error(fmt('error', scope, m, meta)),
  };
}
