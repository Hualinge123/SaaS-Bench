/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, test } from "node:test";

const metricsSourcePath = resolve(
  new URL(".", import.meta.url).pathname,
  "../src/infrastructure/telemetry/metrics.ts"
);

describe("telemetry metric names", () => {
  test("uses jiuwenclaw prefix for request and agent invoke metrics", async () => {
    const source = await readFile(metricsSourcePath, "utf8");

    for (const name of [
      "jiuwenclaw.request.count",
      "jiuwenclaw.request.duration",
      "jiuwenclaw.agent.invoke.count",
      "jiuwenclaw.agent.invoke.duration",
    ]) {
      assert.ok(source.includes(`'${name}'`), `expected ${name} to be defined`);
    }

    for (const legacyName of [
      "officeclaw.request.count",
      "officeclaw.request.duration",
      "officeclaw.agent.invoke.count",
      "officeclaw.agent.invoke.duration",
    ]) {
      assert.ok(
        !source.includes(`'${legacyName}'`),
        `expected ${legacyName} to be removed`
      );
    }
  });
});
