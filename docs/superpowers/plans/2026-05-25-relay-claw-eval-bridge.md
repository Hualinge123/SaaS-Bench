# Relay-Claw Eval Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable `relay-claw` agent backend to SaaS-Bench so existing task loading, isolation, verification, and reporting can run against OfficeClaw.

**Architecture:** Keep SaaS-Bench's evaluation pipeline intact and replace only the agent execution boundary. Add a thin `relay_claw_agent.py` adapter that speaks to OfficeClaw's REST API and returns the same result shape as the current browser-use runner. Wire backend selection through `run.py` with a new `--agent` CLI flag.

**Tech Stack:** Python 3.10+, `httpx`, `pytest`, existing SaaS-Bench task/verify/reporting pipeline

---

## File Map

- Create: `saas_bench/relay_claw_agent.py`
  Responsibility: OfficeClaw API client flow, polling, result normalization, output persistence.
- Create: `tests/test_relay_claw_agent.py`
  Responsibility: Adapter happy path, timeout/error path, result-shape coverage.
- Modify: `saas_bench/run.py`
  Responsibility: CLI/backend selection and worker propagation.
- Modify: `pyproject.toml`
  Responsibility: Add `httpx` runtime dependency.

### Task 1: Add backend selection in the harness

**Files:**
- Modify: `saas_bench/run.py`
- Test: `python -m saas_bench.run --help`

- [ ] **Step 1: Add a focused failing CLI/backend propagation test target**

Manual target for this repo:

```bash
python -m saas_bench.run --help
```

Expected before code change:
- Output does not mention `--agent`

- [ ] **Step 2: Verify the red state**

Run:

```bash
python -m saas_bench.run --help
```

Expected:
- Exit `0`
- `--agent` is absent from help text

- [ ] **Step 3: Implement the minimal `run.py` backend switch**

Apply these edits in `saas_bench/run.py`:

```python
def _run_one(
    task: dict,
    slot_id: int,
    apps_config: dict,
    model: str,
    result_dir: str,
    max_steps: int,
    hostname: str,
    use_isolation: bool,
    run_idx: int = 0,
    tasks_dir: str = "",
    agent_type: str = "browser-use",
) -> dict:
    import asyncio

    if agent_type == "relay-claw":
        from saas_bench.relay_claw_agent import run_task
    else:
        from saas_bench.agent import run_task
```

Also:
- Remove the module-level `from saas_bench.agent import run_task`
- Thread `agent_type` through `_run_task_all_runs()`, `main()`, `pool.submit(...)`
- Add CLI:

```python
p.add_argument(
    "--agent",
    choices=["browser-use", "relay-claw"],
    default="browser-use",
    help="Agent backend to use",
)
```

- [ ] **Step 4: Verify the CLI change**

Run:

```bash
python -m saas_bench.run --help
```

Expected:
- Exit `0`
- Help text includes `--agent {browser-use,relay-claw}`

- [ ] **Step 5: Smoke-check legacy default wiring**

Run:

```bash
python -m saas_bench.run --help | rg -- '--agent'
```

Expected:
- One line containing the new flag
- No import-time error from `relay_claw_agent.py` when `browser-use` remains default

### Task 2: Add the relay-claw adapter with a test-first happy path

**Files:**
- Create: `tests/test_relay_claw_agent.py`
- Create: `saas_bench/relay_claw_agent.py`

- [ ] **Step 1: Write a failing happy-path adapter test**

Create `tests/test_relay_claw_agent.py` with:

```python
import json
from pathlib import Path

import httpx
import pytest

from saas_bench.relay_claw_agent import run_task


@pytest.mark.asyncio
async def test_run_task_happy_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    responses = {
        ("GET", "http://localhost:3004/health"): httpx.Response(200, json={"status": "ok"}),
        ("POST", "http://localhost:3004/api/threads"): httpx.Response(201, json={"id": "thread-123"}),
        ("POST", "http://localhost:3004/api/messages"): httpx.Response(
            200,
            json={"status": "processing", "invocationId": "inv-123", "userMessageId": "msg-user"},
        ),
        ("GET", "http://localhost:3004/api/invocations/inv-123"): httpx.Response(
            200,
            json={"id": "inv-123", "status": "succeeded", "threadId": "thread-123"},
        ),
        ("GET", "http://localhost:3004/api/messages"): httpx.Response(
            200,
            json={
                "messages": [
                    {"id": "m1", "role": "assistant", "content": "step one", "timestamp": 1},
                    {"id": "m2", "role": "assistant", "content": "final answer", "timestamp": 2},
                ],
                "hasMore": False,
            },
        ),
        ("DELETE", "http://localhost:3004/api/threads/thread-123"): httpx.Response(200, json={"ok": True}),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, str(request.url).split("?")[0])
        if key == ("GET", "http://localhost:3004/api/messages"):
            assert request.url.params["threadId"] == "thread-123"
            return responses[key]
        return responses[key]

    transport = httpx.MockTransport(handler)

    async def client_factory(*args, **kwargs):
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setenv("RELAY_CLAW_USER", "saas-bench-eval")
    monkeypatch.setattr("saas_bench.relay_claw_agent._build_async_client", client_factory)

    task = {"task_id": "demo_task"}
    result = await run_task(task, "dummy-model", "do the task", str(tmp_path), run_idx=0)

    assert result["task_id"] == "demo_task"
    assert result["status"] == "completed"
    assert "final answer" in result["agent_output"]
    assert len(result["trajectory"]) == 2
    saved = json.loads((tmp_path / "demo_task_r0.json").read_text())
    assert saved["status"] == "completed"
```

- [ ] **Step 2: Verify the red state**

Run:

```bash
pytest tests/test_relay_claw_agent.py::test_run_task_happy_path -v
```

Expected:
- FAIL because `saas_bench.relay_claw_agent` does not exist

- [ ] **Step 3: Implement the minimal adapter**

Create `saas_bench/relay_claw_agent.py` with these main units:

```python
import json
import os
import time
from pathlib import Path

import httpx


def _build_async_client(*, base_url: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=base_url, timeout=30.0)


async def run_task(
    task: dict,
    model_name: str,
    prompt: str,
    result_dir: str,
    max_steps: int = 80,
    slot_id: int | None = None,
    todo_md: str | None = None,
    run_idx: int | None = None,
    input_files: list[str] | None = None,
) -> dict:
    ...
```

Implementation requirements:
- Read env vars `RELAY_CLAW_API_URL`, `RELAY_CLAW_USER`, `RELAY_CLAW_TIMEOUT`, `RELAY_CLAW_POLL_INTERVAL`, `RELAY_CLAW_STUCK_TIMEOUT`
- `GET /health`
- `POST /api/threads` with `X-Office-Claw-User`
- `POST /api/messages` with `content` and `threadId`
- Poll `GET /api/invocations/{id}` until `succeeded|failed|canceled`
- `GET /api/messages?threadId=...&limit=50`
- Build:

```python
{
    "task_id": task_id,
    "status": "completed" or "error",
    "agent_output": combined_text,
    "trajectory": trajectory,
}
```

- Persist output to:

```python
Path(result_dir) / f"{task_id}{run_suffix}.json"
```

- [ ] **Step 4: Verify the green state**

Run:

```bash
pytest tests/test_relay_claw_agent.py::test_run_task_happy_path -v
```

Expected:
- PASS

### Task 3: Lock in timeout and failed-invocation behavior

**Files:**
- Modify: `tests/test_relay_claw_agent.py`
- Modify: `saas_bench/relay_claw_agent.py`

- [ ] **Step 1: Write failing error-path tests**

Append to `tests/test_relay_claw_agent.py`:

```python
@pytest.mark.asyncio
async def test_run_task_returns_error_when_health_check_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(503, json={"status": "down"}))

    async def client_factory(*args, **kwargs):
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setattr("saas_bench.relay_claw_agent._build_async_client", client_factory)

    result = await run_task({"task_id": "health_fail"}, "dummy", "prompt", str(tmp_path))

    assert result["status"] == "error"
    assert "relay-claw not available" in " ".join(result.get("error_steps", []))


@pytest.mark.asyncio
async def test_run_task_returns_error_when_invocation_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    sequence = {
        ("GET", "http://localhost:3004/health"): httpx.Response(200, json={"status": "ok"}),
        ("POST", "http://localhost:3004/api/threads"): httpx.Response(201, json={"id": "thread-err"}),
        ("POST", "http://localhost:3004/api/messages"): httpx.Response(
            200,
            json={"status": "processing", "invocationId": "inv-err"},
        ),
        ("GET", "http://localhost:3004/api/invocations/inv-err"): httpx.Response(
            200,
            json={"id": "inv-err", "status": "failed", "error": "agent crashed"},
        ),
        ("DELETE", "http://localhost:3004/api/threads/thread-err"): httpx.Response(200, json={"ok": True}),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return sequence[(request.method, str(request.url).split("?")[0])]

    transport = httpx.MockTransport(handler)

    async def client_factory(*args, **kwargs):
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setattr("saas_bench.relay_claw_agent._build_async_client", client_factory)

    result = await run_task({"task_id": "inv_fail"}, "dummy", "prompt", str(tmp_path))

    assert result["status"] == "error"
    assert "agent crashed" in result.get("error", "")
```

- [ ] **Step 2: Verify the red state**

Run:

```bash
pytest tests/test_relay_claw_agent.py -v
```

Expected:
- New tests fail because error mapping is incomplete

- [ ] **Step 3: Implement the minimal error handling**

Add to `saas_bench/relay_claw_agent.py`:
- Health check branch returning:

```python
{
    "task_id": task_id,
    "status": "error",
    "agent_output": "",
    "trajectory": [],
    "error_steps": ["relay-claw not available"],
}
```

- Failed/canceled/timeout/stuck mapping:

```python
result["error"] = detail
result["error_steps"] = [detail]
```

- `finally` cleanup for thread deletion, best-effort only

- [ ] **Step 4: Verify the green state**

Run:

```bash
pytest tests/test_relay_claw_agent.py -v
```

Expected:
- All tests PASS

### Task 4: Add dependency and full harness smoke verification

**Files:**
- Modify: `pyproject.toml`
- Modify: `saas_bench/run.py`
- Test: adapter and CLI smoke commands

- [ ] **Step 1: Write the failing dependency check**

Run:

```bash
python -c "import httpx"
```

Expected before dependency change:
- May fail with `ModuleNotFoundError: No module named 'httpx'`

- [ ] **Step 2: Verify the red state**

Run:

```bash
python -c "import httpx"
```

Expected:
- If it fails, that confirms the declared dependency gap
- If it already passes locally, still proceed with manifest update because packaging is incomplete

- [ ] **Step 3: Add the runtime dependency**

Modify `pyproject.toml` dependencies to include:

```toml
dependencies = [
    "browser-use",
    "httpx>=0.27",
    "playwright>=1.40",
    "pyyaml>=6.0",
]
```

- [ ] **Step 4: Verify adapter tests and CLI together**

Run:

```bash
pytest tests/test_relay_claw_agent.py -v
python -m saas_bench.run --help
```

Expected:
- Test suite PASS
- CLI help exits `0` and includes `--agent`

### Task 5: End-to-end dry run guidance and result contract check

**Files:**
- Modify: `saas_bench/relay_claw_agent.py` if result shape mismatches
- Test: one local dry-run command

- [ ] **Step 1: Write a dry-run checklist against the result contract**

Inspect the current browser-use result shape in `saas_bench/agent.py` and ensure relay-claw output includes:

```python
{
    "task_id": ...,
    "status": ...,
    "agent_output": ...,
    "trajectory": ...,
}
```

- [ ] **Step 2: Verify shape compatibility**

Run:

```bash
rg -n '"task_id"|agent_output|trajectory|status' saas_bench/agent.py saas_bench/relay_claw_agent.py
```

Expected:
- Matching top-level keys are visible in both files

- [ ] **Step 3: Dry-run one command template**

Run after implementation on a machine with OfficeClaw up:

```bash
RELAY_CLAW_API_URL=http://localhost:3004 \
RELAY_CLAW_USER=saas-bench-eval \
python -m saas_bench.run \
  --tasks-dir tasks/uni-m \
  --task-ids software_002 \
  --agent relay-claw \
  --workers 1 \
  --result-dir results-relay-claw \
  --no-report
```

Expected:
- Harness starts
- No import/runtime error from backend selection
- Result JSON is written under `results-relay-claw/<model>/`

- [ ] **Step 4: Full verification pass**

Run:

```bash
pytest tests/test_relay_claw_agent.py -v
python -m saas_bench.run --help | rg -- '--agent'
```

Expected:
- All adapter tests PASS
- CLI exposes `relay-claw`

