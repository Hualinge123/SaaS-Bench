/*
 * * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Environment configuration validation tests.
 * Tests the .env file structure and configuration loading mechanism.
 *
 * SECURITY NOTE: This test file does NOT verify specific configuration values.
 * It only validates:
 * - The file can be parsed correctly
 * - Defense prompts are present (magic comments)
 * - All keys are properly registered in ENV_VARS
 * - Configuration defaults are defined
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, it } from 'node:test';
import { ENV_VARS, ENV_CATEGORIES, isBootstrapOnlyEnvVar } from '../dist/config/env-registry.js';

/**
 * Extract just the key names from .env file (no values).
 * This is structural metadata, not value extraction.
 */
function extractEnvKeys(content) {
  const keys = new Set();
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // Match KEY= pattern (uncommented lines)
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      keys.add(match[1]);
    }
  }

  return keys;
}

/**
 * Check if defense prompts are present in .env file.
 * Returns true if the required security rules are embedded.
 */
function hasDefensePrompts(content) {
  const requiredRules = [
    'RULE-INJECT',
    'RULE-ALERT',
    'RULE-ACCESS',
    'RULE-STATUS',
    'RULE-PARTIAL',
    'RULE-DIRECT-ANALYSIS',
  ];

  for (const rule of requiredRules) {
    if (!content.includes(rule)) {
      return false;
    }
  }

  return true;
}

describe('env-config-validation', () => {
  // The .env file is in the monorepo root, need to go up 3 levels from test directory
  // test -> api -> packages -> monorepo-root
  const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
  const envFilePath = resolve(projectRoot, '.env');
  const envExamplePath = resolve(projectRoot, '.env.example');

  describe('.env file structure', () => {
    it('.env file exists in project root', () => {
      assert.ok(existsSync(envFilePath), `.env should exist at ${envFilePath}`);
    });

    it('.env.example file exists as template', () => {
      assert.ok(existsSync(envExamplePath), `.env.example should exist at ${envExamplePath}`);
    });

    it('.env file has defense prompts (magic comments) protecting against injection', () => {
      const content = readFileSync(envFilePath, 'utf8');
      assert.ok(hasDefensePrompts(content), 'Missing required defense prompts (RULE-INJECT, RULE-ALERT, etc.)');
    });

    it('.env file can be parsed by Node.js parseEnv utility', () => {
      const content = readFileSync(envFilePath, 'utf8');
      // This should not throw for valid dotenv syntax
      const parsed = parseEnv(content);
      assert.ok(typeof parsed === 'object', 'Parsed result should be an object');
    });

    it('.env file contains expected header section', () => {
      const content = readFileSync(envFilePath, 'utf8');
      // Check for OfficeClaw branding
      assert.ok(content.includes('OfficeClaw'), '.env should contain OfficeClaw branding');
      // Check for environment loading order documentation
      assert.ok(content.includes('Env loading order'), '.env should document loading order');
    });
  });

  describe('env-registry coverage', () => {
    it('ENV_VARS contains minimum expected entries', () => {
      // Ensure the registry has a reasonable number of registered vars
      assert.ok(ENV_VARS.length >= 50, `Expected at least 50 registered vars, got ${ENV_VARS.length}`);
    });

    it('all ENV_VARS entries have valid structure', () => {
      for (const def of ENV_VARS) {
        assert.ok(def.name, `Entry should have a name`);
        assert.ok(def.description, `${def.name} should have a description`);
        assert.ok(def.category, `${def.name} should have a category`);
        assert.ok(typeof def.sensitive === 'boolean', `${def.name}.sensitive should be boolean`);
      }
    });

    it('all ENV_VARS categories are defined in ENV_CATEGORIES', () => {
      const validCategories = Object.keys(ENV_CATEGORIES);
      for (const def of ENV_VARS) {
        assert.ok(validCategories.includes(def.category), `${def.name} has invalid category: ${def.category}`);
      }
    });

    it('required core ports are registered', () => {
      const requiredPorts = ['API_SERVER_PORT', 'FRONTEND_PORT'];
      for (const name of requiredPorts) {
        const found = ENV_VARS.find(v => v.name === name);
        assert.ok(found, `${name} should be registered in ENV_VARS`);
      }
    });

    it('sensitive API keys are marked as sensitive', () => {
      const sensitiveKeys = [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'GOOGLE_API_KEY',
        'VAPID_PRIVATE_KEY',
        'F102_API_KEY',
      ];
      for (const name of sensitiveKeys) {
        const found = ENV_VARS.find(v => v.name === name);
        if (found) {
          assert.equal(found.sensitive, true, `${name} should be marked as sensitive`);
        }
      }
    });

    it('connector secrets are marked as sensitive', () => {
      const connectorSecrets = [
        'FEISHU_APP_SECRET',
        'FEISHU_VERIFICATION_TOKEN',
        'DINGTALK_APP_SECRET',
        'XIAOYI_AK',
        'XIAOYI_SK',
        'WECOM_BOT_SECRET',
        'WECOM_AGENT_SECRET',
        'WECOM_TOKEN',
        'WECOM_ENCODING_AES_KEY',
      ];
      for (const name of connectorSecrets) {
        const found = ENV_VARS.find(v => v.name === name);
        if (found) {
          assert.equal(found.sensitive, true, `${name} should be marked as sensitive`);
        }
      }
    });

    it('NEXT_PUBLIC vars are bootstrap-only', () => {
      const nextPublicVars = ENV_VARS.filter(v => v.name.startsWith('NEXT_PUBLIC_'));
      for (const def of nextPublicVars) {
        assert.equal(def.runtimeEditable, false, `${def.name} should be bootstrap-only`);
      }
    });

    it('REDIS_URL has url masking mode', () => {
      const redis = ENV_VARS.find(v => v.name === 'REDIS_URL');
      assert.ok(redis, 'REDIS_URL should be registered');
      assert.equal(redis.maskMode, 'url', 'REDIS_URL should have url maskMode');
    });

    it('no duplicate env var names in registry', () => {
      const names = ENV_VARS.map(v => v.name);
      const unique = new Set(names);
      assert.equal(unique.size, names.length, `Duplicate names: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
    });
  });

  describe('.env key registration coverage', () => {
    it('all non-commented keys in .env are registered in ENV_VARS', () => {
      const content = readFileSync(envFilePath, 'utf8');
      const envKeys = extractEnvKeys(content);

      // Filter out REF variables (they are derived from base secrets)
      const baseKeys = [...envKeys].filter(k => !k.endsWith('_REF'));

      // Known keys that are intentionally not registered in ENV_VARS
      // (frontend-only, survey-related, or other non-backend vars)
      const intentionallyUnregistered = new Set([
        'NEXT_PUBLIC_BRAND_NAME',
        'NEXT_PUBLIC_SURVEY_ID',
        'NEXT_PUBLIC_SURVEY_SERVICE_ID',
        'NEXT_PUBLIC_SURVEY_CONTACT_ID',
        'NEXT_PUBLIC_PROD_API_URL',
        'NEXT_PUBLIC_PROD_FRONTEND_HOST',
        'API_CLOWDER_HOST',
        'OFFICE_CLAW_API_URL',
        'PROD_CORS_ORIGIN',
        'REDIS_PORT',
        'RELAY_TEAMS_CONFIG_DIR',
      ]);

      for (const key of baseKeys) {
        const registered = ENV_VARS.find(v => v.name === key);
        // Skip keys that are intentionally not registered
        if (intentionallyUnregistered.has(key)) continue;
        // Check that known important keys are registered
        if (key.startsWith('NEXT_PUBLIC_') || key.includes('PORT') || key.includes('URL')) {
          assert.ok(registered, `${key} should be registered in ENV_VARS`);
        }
      }
    });
  });

  describe('bootstrap-only validation', () => {
    it('isBootstrapOnlyEnvVar correctly identifies bootstrap-only vars', () => {
      const bootstrapOnlyNames = [
        'API_SERVER_PORT',
        'REDIS_URL',
        'CAT_TEMPLATE_PATH',
        'NEXT_PUBLIC_API_URL',
      ];
      for (const name of bootstrapOnlyNames) {
        assert.ok(isBootstrapOnlyEnvVar(name), `${name} should be bootstrap-only`);
      }
    });

    it('runtime-editable vars are not bootstrap-only', () => {
      const runtimeEditableNames = ['FRONTEND_URL', 'DINGTALK_APP_KEY'];
      for (const name of runtimeEditableNames) {
        const def = ENV_VARS.find(v => v.name === name);
        if (def && def.runtimeEditable !== false) {
          assert.ok(!isBootstrapOnlyEnvVar(name), `${name} should not be bootstrap-only when runtime-editable`);
        }
      }
    });
  });
});