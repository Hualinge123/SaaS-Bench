/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { findMonorepoRoot } from '../utils/monorepo-root.js';

const LOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_SOURCE_BYTES = 120 * 1024 * 1024;

interface LogFileEntry {
  absolutePath: string;
  archivePath: string;
  size: number;
  mtimeMs: number;
}

interface SupportLogsRouteOptions {
  projectRoot?: string;
  jiuwenclawDataDir?: string;
}

function toArchivePath(rootLabel: string, rootPath: string, filePath: string): string {
  return [rootLabel, relative(rootPath, filePath)].join('/').replace(/\\/g, '/');
}

function resolveJiuwenClawDataDir(): string {
  const officeClawDataDir = resolve((process.env.OFFICE_CLAW_DATA_DIR ?? '').trim() || join(homedir(), '.office-claw'));
  return resolve((process.env.JIUWENCLAW_DATA_DIR ?? '').trim() || join(officeClawDataDir, '.jiuwenclaw'));
}

function resolveLogRoots(
  projectRoot = findMonorepoRoot(),
  jiuwenclawDataDir = resolveJiuwenClawDataDir(),
): Array<{ label: string; path: string }> {
  return [
    { label: 'data-logs-api', path: resolve(projectRoot, 'data', 'logs', 'api') },
    { label: 'startup-logs', path: resolve(projectRoot, 'logs', 'startup') },
    { label: 'crash-reports', path: resolve(projectRoot, 'logs', 'crash-reports') },
    { label: 'windows-runtime', path: resolve(projectRoot, '.office-claw', 'run', 'windows') },
    { label: 'jiuwenclaw-service-logs', path: resolve(jiuwenclawDataDir, 'service_default', '.logs') },
  ];
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith(sep));
}

async function collectRecentLogFiles(
  root: { label: string; path: string },
  cutoffMs: number,
): Promise<LogFileEntry[]> {
  if (!existsSync(root.path)) return [];
  const entries: LogFileEntry[] = [];

  async function visit(dir: string): Promise<void> {
    if (!isPathInside(root.path, dir)) return;
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children) {
      const childPath = join(dir, child.name);
      if (child.isDirectory()) {
        await visit(childPath);
        continue;
      }
      if (!child.isFile()) continue;
      const fileStat = await stat(childPath);
      if (fileStat.mtimeMs < cutoffMs) continue;
      if (fileStat.size > MAX_FILE_BYTES) continue;
      entries.push({
        absolutePath: childPath,
        archivePath: toArchivePath(root.label, root.path, childPath),
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      });
    }
  }

  await visit(root.path);
  return entries;
}

async function buildSupportLogArchive(
  projectRoot = findMonorepoRoot(),
  jiuwenclawDataDir = resolveJiuwenClawDataDir(),
): Promise<{ filePath: string; fileName: string; fileCount: number }> {
  const now = new Date();
  const cutoffMs = now.getTime() - LOG_RETENTION_MS;
  const roots = resolveLogRoots(projectRoot, jiuwenclawDataDir);
  const zip = new JSZip();
  const files: LogFileEntry[] = [];
  let totalBytes = 0;

  for (const root of roots) {
    const rootFiles = await collectRecentLogFiles(root, cutoffMs);
    for (const file of rootFiles.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      if (totalBytes + file.size > MAX_ARCHIVE_SOURCE_BYTES) continue;
      files.push(file);
      totalBytes += file.size;
    }
  }

  for (const file of files) {
    zip.file(file.archivePath, await readFile(file.absolutePath));
  }

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        cutoffAt: new Date(cutoffMs).toISOString(),
        fileCount: files.length,
        totalSourceBytes: totalBytes,
        roots: roots.map((root) => ({ label: root.label, path: root.path, exists: existsSync(root.path) })),
        files: files.map((file) => ({
          path: file.archivePath,
          bytes: file.size,
          modifiedAt: new Date(file.mtimeMs).toISOString(),
        })),
      },
      null,
      2,
    ),
  );

  const archiveBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const archiveDir = resolve(projectRoot, 'data', 'support-logs');
  await mkdir(archiveDir, { recursive: true });
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const fileName = `officeclaw-logs-${timestamp}.zip`;
  const filePath = resolve(archiveDir, fileName);
  await writeFile(filePath, archiveBuffer);
  return { filePath, fileName: basename(fileName), fileCount: files.length };
}

export async function supportLogsRoutes(app: FastifyInstance, options: SupportLogsRouteOptions = {}): Promise<void> {
  app.post('/api/support/logs/archive', async (_request, reply) => {
    const archive = await buildSupportLogArchive(options.projectRoot, options.jiuwenclawDataDir);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${archive.fileName}"`)
      .header('X-Log-Archive-Filename', archive.fileName)
      .header('X-Log-Archive-File-Count', String(archive.fileCount))
      .send(createReadStream(archive.filePath));
  });
}
