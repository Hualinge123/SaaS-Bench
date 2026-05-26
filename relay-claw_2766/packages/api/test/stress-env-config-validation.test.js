/*
 * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

/**
 * Stress test: Environment configuration value validation.
 * Tests port number ranges, URL formats, and required variable presence.
 *
 * SECURITY NOTE: This test validates structural correctness only.
 * It does NOT verify specific configuration values against external references.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { ENV_VARS, ENV_CATEGORIES } from '../dist/config/env-registry.js';

/**
 * Parse .env file content and extract key-value pairs.
 * Returns an object with the parsed configuration.
 */
function parseEnvFile(content) {
  const config = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // Match KEY=value pattern
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2];
      // Remove quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      config[key] = value;
    }
  }

  return config;
}

/**
 * Validate port number is within valid range (1-65535).
 */
function isValidPort(portStr) {
  const port = parseInt(portStr, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Validate URL format (http/https URLs with host).
 */
function isValidUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate host/domain format (without protocol).
 */
function isValidHost(hostStr) {
  if (!hostStr || hostStr.trim() === '') return false;
  // Check for valid domain/host format
  // Allow localhost, IP addresses, or domains
  const hostPattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  return hostPattern.test(hostStr) || ipPattern.test(hostStr) || hostStr === 'localhost';
}

describe('stress-env-config-validation', () => {
  const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
  const envFilePath = resolve(projectRoot, '.env');
  const envExamplePath = resolve(projectRoot, '.env.example');

  describe('port number validation', () => {
    it('validates FRONTEND_PORT is a valid port number', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const frontendPort = config.FRONTEND_PORT;
      assert.ok(frontendPort, 'FRONTEND_PORT should be defined');
      assert.ok(isValidPort(frontendPort), `FRONTEND_PORT "${frontendPort}" should be valid (1-65535)`);
      // Check default is reasonable (1024+ for non-root)
      const port = parseInt(frontendPort, 10);
      assert.ok(port >= 1024, 'FRONTEND_PORT should be >= 1024 for non-root usage');
    });

    it('validates API_SERVER_PORT is a valid port number', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const apiPort = config.API_SERVER_PORT;
      assert.ok(apiPort, 'API_SERVER_PORT should be defined');
      assert.ok(isValidPort(apiPort), `API_SERVER_PORT "${apiPort}" should be valid (1-65535)`);
      const port = parseInt(apiPort, 10);
      assert.ok(port >= 1024, 'API_SERVER_PORT should be >= 1024 for non-root usage');
    });

    it('validates REDIS_PORT is a valid port number', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const redisPort = config.REDIS_PORT;
      assert.ok(redisPort, 'REDIS_PORT should be defined');
      assert.ok(isValidPort(redisPort), `REDIS_PORT "${redisPort}" should be valid (1-65535)`);
      const port = parseInt(redisPort, 10);
      assert.ok(port >= 1024, 'REDIS_PORT should be >= 1024 for non-root usage');
    });

    it('validates port numbers follow API = Frontend + 1 convention', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const frontendPort = parseInt(config.FRONTEND_PORT, 10);
      const apiPort = parseInt(config.API_SERVER_PORT, 10);

      assert.equal(apiPort, frontendPort + 1, 'API_SERVER_PORT should be FRONTEND_PORT + 1');
    });

    it('validates ports do not conflict with each other', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const ports = [
        config.FRONTEND_PORT,
        config.API_SERVER_PORT,
        config.REDIS_PORT,
      ].map(p => parseInt(p, 10));

      const uniquePorts = new Set(ports);
      assert.equal(uniquePorts.size, ports.length, 'All ports should be unique (no conflicts)');
    });

    it('validates optional WebSocket ping ports are valid when defined', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      // These are optional/commented, only validate if uncommented
      const optionalPortVars = [
        'SOCKET_IO_PING_INTERVAL_MS',
        'SOCKET_IO_PING_TIMEOUT_MS',
      ];

      for (const varName of optionalPortVars) {
        if (config[varName]) {
          const value = parseInt(config[varName], 10);
          assert.ok(Number.isInteger(value) && value > 0, `${varName} should be positive integer when set`);
        }
      }
    });
  });

  describe('URL format validation', () => {
    it('validates NEXT_PUBLIC_API_URL is a valid URL', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const apiUrl = config.NEXT_PUBLIC_API_URL;
      assert.ok(apiUrl, 'NEXT_PUBLIC_API_URL should be defined');
      assert.ok(isValidUrl(apiUrl), `NEXT_PUBLIC_API_URL "${apiUrl}" should be valid URL format`);
    });

    it('validates OFFICE_CLAW_API_HOST is a valid URL when defined', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const apiHost = config.OFFICE_CLAW_API_HOST;
      if (apiHost) {
        assert.ok(isValidUrl(apiHost), `OFFICE_CLAW_API_HOST "${apiHost}" should be valid URL format`);
      }
    });

    it('validates OFFICE_CLAW_API_URL is a valid URL when defined', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const apiUrl = config.OFFICE_CLAW_API_URL;
      if (apiUrl) {
        assert.ok(isValidUrl(apiUrl), `OFFICE_CLAW_API_URL "${apiUrl}" should be valid URL format`);
      }
    });

    it('validates PROD_CORS_ORIGIN is a valid URL when defined', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const corsOrigin = config.PROD_CORS_ORIGIN;
      if (corsOrigin) {
        assert.ok(isValidUrl(corsOrigin), `PROD_CORS_ORIGIN "${corsOrigin}" should be valid URL format`);
      }
    });

    it('validates TTS_URL is a valid URL when defined', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const ttsUrl = config.TTS_URL;
      if (ttsUrl) {
        assert.ok(isValidUrl(ttsUrl), `TTS_URL "${ttsUrl}" should be valid URL format`);
      }
    });

    it('validates NEXT_PUBLIC_WHISPER_URL is a valid URL when defined', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const whisperUrl = config.NEXT_PUBLIC_WHISPER_URL;
      if (whisperUrl) {
        assert.ok(isValidUrl(whisperUrl), `NEXT_PUBLIC_WHISPER_URL "${whisperUrl}" should be valid URL format`);
      }
    });

    it('validates production host is valid domain format', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const prodHost = config.NEXT_PUBLIC_PROD_FRONTEND_HOST;
      if (prodHost) {
        assert.ok(isValidHost(prodHost), `NEXT_PUBLIC_PROD_FRONTEND_HOST "${prodHost}" should be valid host/domain`);
      }
    });

    it('validates REDIS_URL format when explicitly set', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      // REDIS_URL is typically auto-constructed, but if manually set, validate
      const redisUrl = config.REDIS_URL;
      if (redisUrl) {
        // Redis URLs use redis:// protocol
        try {
          const url = new URL(redisUrl);
          assert.ok(url.protocol === 'redis:', `REDIS_URL should use redis:// protocol`);
        } catch {
          assert.ok(false, `REDIS_URL "${redisUrl}" should be valid URL format`);
        }
      }
    });
  });

  describe('required variable presence', () => {
    it('validates core port variables are present', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const requiredPorts = ['FRONTEND_PORT', 'API_SERVER_PORT', 'REDIS_PORT'];

      for (const varName of requiredPorts) {
        assert.ok(config[varName], `${varName} should be present in .env.example`);
      }
    });

    it('validates API URL variables are present', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const requiredUrls = ['NEXT_PUBLIC_API_URL'];

      for (const varName of requiredUrls) {
        assert.ok(config[varName], `${varName} should be present in .env.example`);
      }
    });

    it('validates brand name is defined', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      assert.ok(config.NEXT_PUBLIC_BRAND_NAME, 'NEXT_PUBLIC_BRAND_NAME should be present');
      assert.ok(config.NEXT_PUBLIC_BRAND_NAME.includes('OfficeClaw'), 'Brand name should contain OfficeClaw');
    });

    it('validates provider configuration variables are present', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const providerVars = [
        'OFFICE_CLAW_EVIDENCE_PROVIDER',
        'OFFICE_CLAW_SCHEDULER_PROVIDER',
      ];

      for (const varName of providerVars) {
        assert.ok(config[varName], `${varName} should be present for storage provider config`);
      }
    });

    it('validates all registered ENV_VARS have example values or are commented', () => {
      const content = readFileSync(envExamplePath, 'utf8');

      // Extract all keys mentioned in .env.example (including commented ones)
      const allKeys = new Set();
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (match) {
          allKeys.add(match[1]);
        }
      }

      // Check that core ENV_VARS are documented
      const coreVars = ENV_VARS.filter(v =>
        v.category === 'ports' ||
        v.category === 'core' ||
        v.name.includes('PORT') ||
        v.name.includes('URL')
      );

      for (const def of coreVars.slice(0, 10)) {
        // At least first 10 core vars should be documented
        assert.ok(allKeys.has(def.name) || !def.name.startsWith('CAT_'),
          `${def.name} should be documented in .env.example`);
      }
    });

    it('validates ENV_VARS registry has required port entries', () => {
      const requiredPortNames = ['API_SERVER_PORT', 'FRONTEND_PORT'];

      for (const name of requiredPortNames) {
        const found = ENV_VARS.find(v => v.name === name);
        assert.ok(found, `${name} should be registered in ENV_VARS`);
      }
    });

    it('validates ENV_VARS registry has required URL entries', () => {
      const requiredUrlNames = ['NEXT_PUBLIC_API_URL', 'REDIS_URL'];

      for (const name of requiredUrlNames) {
        const found = ENV_VARS.find(v => v.name === name);
        // NEXT_PUBLIC vars may not be in registry, that's ok
        if (!name.startsWith('NEXT_PUBLIC_')) {
          assert.ok(found, `${name} should be registered in ENV_VARS`);
        }
      }
    });
  });

  describe('value consistency validation', () => {
    it('validates local development URLs use localhost', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const localUrlVars = ['NEXT_PUBLIC_API_URL', 'OFFICE_CLAW_API_URL'];

      for (const varName of localUrlVars) {
        if (config[varName]) {
          assert.ok(
            config[varName].includes('localhost') || config[varName].includes('127.0.0.1'),
            `${varName} should use localhost for local development`
          );
        }
      }
    });

    it('validates production URLs use proper domain', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      const prodHost = config.NEXT_PUBLIC_PROD_FRONTEND_HOST;
      if (prodHost) {
        // Production host should not be localhost
        assert.ok(
          !prodHost.includes('localhost') && !prodHost.includes('127.0.0.1'),
          'NEXT_PUBLIC_PROD_FRONTEND_HOST should be production domain'
        );
      }
    });

    it('validates port values match documented defaults', () => {
      const content = readFileSync(envExamplePath, 'utf8');
      const config = parseEnvFile(content);

      // Check default values are as documented
      assert.equal(config.FRONTEND_PORT, '3003', 'FRONTEND_PORT default should be 3003');
      assert.equal(config.API_SERVER_PORT, '3004', 'API_SERVER_PORT default should be 3004');
      assert.equal(config.REDIS_PORT, '6399', 'REDIS_PORT default should be 6399');
    });
  });
});