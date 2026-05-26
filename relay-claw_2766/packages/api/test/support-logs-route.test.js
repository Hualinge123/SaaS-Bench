import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import JSZip from 'jszip';
import { supportLogsRoutes } from '../dist/routes/support-logs.js';

test('support logs route returns a zip with only recent log files', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'officeclaw-support-logs-'));
  try {
    const apiLogDir = join(projectRoot, 'data', 'logs', 'api');
    const startupLogDir = join(projectRoot, 'logs', 'startup');
    const jiuwenclawDataDir = join(projectRoot, 'home', '.office-claw', '.jiuwenclaw');
    const jiuwenclawLogDir = join(jiuwenclawDataDir, 'service_default', '.logs');
    await mkdir(apiLogDir, { recursive: true });
    await mkdir(startupLogDir, { recursive: true });
    await mkdir(jiuwenclawLogDir, { recursive: true });

    const recentLogPath = join(apiLogDir, 'recent.log');
    const startupLogPath = join(startupLogDir, 'startup.log');
    const jiuwenclawLogPath = join(jiuwenclawLogDir, 'full.log');
    const oldLogPath = join(apiLogDir, 'old.log');
    await writeFile(recentLogPath, 'recent-api-log');
    await writeFile(startupLogPath, 'startup-log');
    await writeFile(jiuwenclawLogPath, 'jiuwenclaw-service-log');
    await writeFile(oldLogPath, 'old-api-log');
    const oldDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    await utimes(oldLogPath, oldDate, oldDate);

    const app = Fastify();
    await app.register(supportLogsRoutes, { projectRoot, jiuwenclawDataDir });
    const response = await app.inject({ method: 'POST', url: '/api/support/logs/archive' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/zip');
    assert.match(String(response.headers['x-log-archive-filename']), /^officeclaw-logs-.*\.zip$/);
    assert.equal(response.headers['x-log-archive-file-count'], '3');

    const zip = await JSZip.loadAsync(response.rawPayload);
    assert.ok(zip.file('manifest.json'));
    assert.ok(zip.file('data-logs-api/recent.log'));
    assert.ok(zip.file('startup-logs/startup.log'));
    assert.ok(zip.file('jiuwenclaw-service-logs/full.log'));
    assert.equal(zip.file('data-logs-api/old.log'), null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
