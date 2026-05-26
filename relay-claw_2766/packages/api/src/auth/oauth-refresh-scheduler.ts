import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AuthModule } from './module.js';

interface SchedulerOptions {
  env?: NodeJS.ProcessEnv;
}

function resolveSecureConfigDir(env: NodeJS.ProcessEnv): string {
  const configured = env.OFFICE_CLAW_SECURE_CONFIG_DIR?.trim();
  if (configured) return configured;
  return join(env.HOME ?? process.cwd(), '.config', 'secure-config-nodejs');
}

export async function initOauthRefreshScheduler(app: FastifyInstance, authModule: AuthModule, options: SchedulerOptions = {}) {
  const env = options.env ?? process.env;
  const enabled = (env.OFFICE_CLAW_OAUTH_REFRESH_ENABLED ?? 'true') === 'true';
  if (!enabled) return;

  const intervalMs = Number(env.OFFICE_CLAW_OAUTH_REFRESH_INTERVAL_MS) || 15 * 60 * 1000;
  const maxRetries = Number(env.OFFICE_CLAW_OAUTH_REFRESH_MAX_RETRY) || 3;
  const concurrency = Number(env.OFFICE_CLAW_OAUTH_REFRESH_CONCURRENCY) || 3;

  const provider = authModule.getActiveProvider();
  if (!provider || provider.id !== 'huawei-oauth' || typeof provider.refresh !== 'function') {
    app.log.info({ reason: 'active provider is not huawei-oauth or does not support refresh' }, '[oauth-refresh] Skipping scheduler');
    return;
  }

  const refreshFn = provider.refresh.bind(provider);
  const logoutFn = typeof provider.logout === 'function' ? provider.logout.bind(provider) : undefined;
  const secureDir = resolveSecureConfigDir(env);
  const failureCounts = new Map<string, number>();

  async function scanAndRefresh() {
    let files: string[] = [];
    try {
      files = await readdir(secureDir);
    } catch (err) {
      // directory may not exist yet — skip
      return;
    }

    const oauthFiles = files.filter((f) => f.startsWith('oauth-') && f.endsWith('.json'));
    const userIds = oauthFiles.map((f) => {
      try {
        const name = f.slice('oauth-'.length, -'.json'.length);
        return decodeURIComponent(name);
      } catch {
        return null;
      }
    }).filter(Boolean) as string[];

    const queue: Array<() => Promise<void>> = userIds.map((userId) => async () => {
      try {
        const session = { sessionId: 'scheduler', userId, providerId: provider.id, providerState: undefined, expiresAt: null } as any;
        const refreshed = await refreshFn(session);
        if (refreshed) {
          app.log.info({ userId }, '[oauth-refresh] refreshed');
          failureCounts.delete(userId);
        } else {
          const prev = failureCounts.get(userId) ?? 0;
          const next = prev + 1;
          failureCounts.set(userId, next);
          app.log.warn({ userId, attempt: next }, '[oauth-refresh] refresh returned null');
          if (next >= maxRetries && logoutFn) {
            app.log.warn({ userId }, '[oauth-refresh] reached max retries, invoking logout to clear stored profile');
            try {
              await logoutFn(session);
            } catch (e) {
              app.log.warn({ userId, error: e instanceof Error ? e.message : String(e) }, '[oauth-refresh] logout failed');
            }
            failureCounts.delete(userId);
          }
        }
      } catch (err) {
        const prev = failureCounts.get(userId) ?? 0;
        const next = prev + 1;
        failureCounts.set(userId, next);
        app.log.warn({ userId, error: err instanceof Error ? err.message : String(err), attempt: next }, '[oauth-refresh] refresh error');
        if (next >= maxRetries && logoutFn) {
          app.log.warn({ userId }, '[oauth-refresh] reached max retries after error, invoking logout');
          try {
            const session = { sessionId: 'scheduler', userId, providerId: provider.id, providerState: undefined, expiresAt: null } as any;
            await logoutFn(session);
          } catch (e) {
            app.log.warn({ userId, error: e instanceof Error ? e.message : String(e) }, '[oauth-refresh] logout failed');
          }
          failureCounts.delete(userId);
        }
      }
    });

    // run queue with concurrency
    const workers: Promise<void>[] = [];
    while (queue.length > 0) {
      while (workers.length < concurrency && queue.length > 0) {
        const job = queue.shift()!;
        const p = job().finally(() => {
          const idx = workers.indexOf(p);
          if (idx >= 0) workers.splice(idx, 1);
        });
        workers.push(p);
      }
      // wait for any worker to finish
      if (workers.length > 0) await Promise.race(workers);
    }
    await Promise.all(workers);
  }

  // start interval
  const timer = setInterval(() => {
    void scanAndRefresh();
  }, intervalMs);

  // run once immediately
  void scanAndRefresh();

  // register shutdown
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });

  app.log.info({ intervalMs, concurrency, maxRetries, secureDir }, '[oauth-refresh] scheduler initialized');
}

export default initOauthRefreshScheduler;
