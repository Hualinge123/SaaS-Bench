# Relay-Claw Middleware Design

## Goal

Connect SaaS-Bench to the relay-claw (OfficeClaw) agent platform, allowing SaaS-Bench to invoke relay-claw as an alternative agent backend instead of the built-in browser-use agent.

## Architecture: Thin Adapter Layer (Approach A)

Single file `saas_bench/relay_claw_agent.py` implements the same `run_task()` async function signature as `saas_bench/agent.py`. `run.py` gets a `--agent` CLI flag to switch between `browser-use` (default) and `relay-claw`.

## Component: relay_claw_agent.py

### `run_task()` async function

Signature identical to browser-use agent:

```python
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
) -> dict
```

Returns: `{task_id, status, agent_output, trajectory}` — same contract as browser-use agent.

### Execution Flow

1. **Health check**: `GET /health` — confirm relay-claw is running. If not, return `{status: "error", error_steps: ["relay-claw not available"]}`.

2. **Create thread**: `POST /api/threads` — thread_id = `saas_bench_{task_id}_{run_idx}`, with header `X-Office-Claw-User: {RELAY_CLAW_USER}`.

3. **Send task**: `POST /api/messages` — body: `{content: prompt, threadId: thread_id, targetAgents: [agent_id]}`. Extract `invocationId` from response.

4. **Wait for completion**: Poll `GET /api/invocations/{invocationId}` every `RELAY_CLAW_POLL_INTERVAL` seconds. Check `status` field:
   - `queued` → `running` → `succeeded` (success) / `failed` / `canceled` (error)
   - Stuck detection: if no status change for 300s, return stuck error.
   - Total timeout: `RELAY_CLAW_TIMEOUT` seconds.

5. **Fetch result**: `GET /api/messages?threadId={thread_id}&limit=50` — filter assistant messages, concatenate `content` as `agent_output`.

6. **Build trajectory**: Each assistant message becomes a trajectory step:
   ```python
   {
       "step_num": message_index,
       "action": message_type,  # text / tool_use / tool_result
       "result": message_content[:500],
       "timestamp": message_createdAt,
   }
   ```

7. **Thread cleanup**: `DELETE /api/threads/{thread_id}` — cleanup failure does not block result return.

### Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_CLAW_API_URL` | `http://localhost:3004` | relay-claw API base URL |
| `RELAY_CLAW_AGENT_ID` | `office` | Target agent ID |
| `RELAY_CLAW_TIMEOUT` | `300` | Total invocation timeout (seconds) |
| `RELAY_CLAW_POLL_INTERVAL` | `2.0` | Poll interval (seconds) |
| `RELAY_CLAW_USER` | `saas-bench-eval` | X-Office-Claw-User header value |

### Dependencies

- `httpx` — async HTTP client (add as optional dependency in `pyproject.toml` under `[relay-claw]` extras group)

## Component: run.py Modification

### CLI Addition

```python
p.add_argument("--agent", choices=["browser-use", "relay-claw"], default="browser-use",
               help="Agent backend to use")
```

### Dynamic Import

Inside `_run_one()` (not at module level, to avoid process pool serialization issues):

```python
if agent_type == "relay-claw":
    from saas_bench.relay_claw_agent import run_task
else:
    from saas_bench.agent import run_task
```

### Parameter Passing

`_run_one` and `_run_task_all_runs` signatures gain `agent_type` parameter, propagated from `main()` → pool submit → `_run_one`.

### relay-claw Mode Behavior

- Docker containers still managed by SaaS-Bench SlotManager (provides SaaS apps)
- relay-claw agent accesses apps via URLs in the prompt (localhost:{port})
- verify_runner still executed by SaaS-Bench (independent of agent choice)
- No Chrome process management needed (relay-claw owns browser)

## Error Handling

| Scenario | Behavior |
|----------|----------|
| relay-claw not running | Return `{status: "error", error_steps: ["relay-claw not available"]}` |
| Invocation timeout | Return `{status: "error", error_steps: ["timeout after {timeout}s"]}` |
| Invocation stuck (no activity 300s) | Return `{status: "error", error_steps: ["stuck: no activity for 300s"]}` |
| Thread creation failure | Return `{status: "error", error_steps: [error detail]}` |
| Thread cleanup failure | Log warning, do not block result return |

## File Changes Summary

| File | Change |
|------|--------|
| `saas_bench/relay_claw_agent.py` | **New** — relay-claw adapter implementing `run_task()` |
| `saas_bench/run.py` | **Modify** — add `--agent` CLI arg, dynamic import, propagate `agent_type` |
| `pyproject.toml` | **Modify** — add `httpx` as optional `[relay-claw]` dependency |
| `.env.example` | **Modify** — add `RELAY_CLAW_*` environment variables |