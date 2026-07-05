export interface Config {
  databaseUrl: string;
  sessionSecret: string;
  dataDir: string;
  port: number;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET is required (min 32 chars)');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  return {
    databaseUrl,
    sessionSecret,
    dataDir: env.DATA_DIR ?? './data',
    port,
    isProduction: env.NODE_ENV === 'production',
  };
}
