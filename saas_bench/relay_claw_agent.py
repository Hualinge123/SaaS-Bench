"""Relay-claw / OfficeClaw adapter for SaaS-Bench."""

import asyncio
import inspect
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx


_WEB_UI_HINT_KEYWORDS = (
    "code-server",
    "baserow",
    "openproject",
    "navigate via ui",
    "ui clicks only",
    "exact urls",
    "login credentials",
)

_WEB_UI_GUARDRAIL = """Execution policy for this task:
- This is a browser UI task. Prefer browser automation and page interaction.
- Use the exact URLs provided in the task. Do not infer ports, routes, API endpoints, or filesystem paths.
- Do not replace required UI actions with curl, REST API calls, direct filesystem probing, or local shell shortcuts.
- For code-server, open the site in the browser, log in via the page, and use the integrated terminal inside code-server for required commands.
- For Baserow and OpenProject, log in through the browser UI and complete the required actions in the product UI unless the task explicitly asks for an API.
"""


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _build_headers(user: str) -> dict[str, str]:
    headers = {"X-Office-Claw-User": user}
    session_id = os.environ.get("RELAY_CLAW_SESSION_ID", "").strip()
    if session_id:
        headers["Authorization"] = f"Bearer {session_id}"
        headers["X-Office-Claw-Session"] = session_id
    return headers


def _augment_prompt(prompt: str) -> str:
    lowered = prompt.lower()
    if not any(keyword in lowered for keyword in _WEB_UI_HINT_KEYWORDS):
        return prompt
    return f"{_WEB_UI_GUARDRAIL}\n{prompt}"


def _build_async_client(*, base_url: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=base_url, timeout=30.0)


async def _make_client(base_url: str) -> httpx.AsyncClient:
    client = _build_async_client(base_url=base_url)
    if inspect.isawaitable(client):
        client = await client
    return client


def _result_path(result_dir: str, task_id: str, run_idx: int | None) -> Path:
    run_suffix = f"_r{run_idx}" if run_idx is not None else ""
    return Path(result_dir) / f"{task_id}{run_suffix}.json"


def _save_result(result_dir: str, task_id: str, run_idx: int | None, result: dict[str, Any]) -> dict[str, Any]:
    Path(result_dir).mkdir(parents=True, exist_ok=True)
    _result_path(result_dir, task_id, run_idx).write_text(
        json.dumps(result, indent=2, ensure_ascii=False)
    )
    return result


def _message_role(message: dict[str, Any]) -> str | None:
    role = message.get("role")
    if isinstance(role, str) and role:
        return role
    msg_type = message.get("type")
    if isinstance(msg_type, str) and msg_type:
        return msg_type
    return None


def _assistant_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return []
    return [
        message
        for message in messages
        if isinstance(message, dict) and _message_role(message) == "assistant"
    ]


def _assistant_final_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        message
        for message in _assistant_messages(payload)
        if not message.get("isDraft")
    ]


def _assistant_draft_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        message
        for message in _assistant_messages(payload)
        if message.get("isDraft")
    ]


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item.strip())
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text.strip())
        return "\n".join(part for part in parts if part)
    return ""


def _build_trajectory(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    trajectory = []
    for index, message in enumerate(messages, start=1):
        trajectory.append(
            {
                "step_num": index,
                "role": _message_role(message) or "assistant",
                "action": _message_role(message) or "assistant",
                "result": _message_text(message)[:500],
                "timestamp": message.get("timestamp"),
            }
        )
    return trajectory


async def _fetch_history(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    thread_id: str,
) -> dict[str, Any]:
    history_resp = await client.get(
        "/api/messages",
        headers=headers,
        params={"threadId": thread_id, "limit": 50},
    )
    history_resp.raise_for_status()
    return history_resp.json()


def _history_signature(payload: dict[str, Any]) -> tuple[tuple[str, bool, str], ...]:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return ()
    signature: list[tuple[str, bool, str]] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        signature.append(
            (
                str(message.get("id", "")),
                bool(message.get("isDraft")),
                _message_text(message),
            )
        )
    return tuple(signature)


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
) -> dict[str, Any]:
    """Run one task with relay-claw / OfficeClaw and return a SaaS-Bench result dict."""
    del model_name, max_steps, slot_id, todo_md, input_files
    prompt = _augment_prompt(prompt)

    task_id = task["task_id"]
    base_url = os.environ.get("RELAY_CLAW_API_URL", "http://localhost:3004").rstrip("/")
    user = os.environ.get("RELAY_CLAW_USER", "saas-bench-eval")
    timeout_s = _env_int("RELAY_CLAW_TIMEOUT", 300)
    poll_interval_s = max(0.0, _env_float("RELAY_CLAW_POLL_INTERVAL", 2.0))
    stuck_timeout_s = _env_int("RELAY_CLAW_STUCK_TIMEOUT", 300)
    thread_title = f"saas_bench_{task_id}_r{run_idx or 0}"

    result: dict[str, Any] = {
        "task_id": task_id,
        "status": "error",
        "agent_output": "",
        "trajectory": [],
    }

    thread_id: str | None = None
    headers = _build_headers(user)

    client = await _make_client(base_url)
    try:
        health_resp = await client.get("/health", headers=headers)
        if health_resp.status_code != 200:
            result["error_steps"] = ["relay-claw not available"]
            return _save_result(result_dir, task_id, run_idx, result)

        thread_resp = await client.post("/api/threads", headers=headers, json={"title": thread_title})
        thread_resp.raise_for_status()
        thread_data = thread_resp.json()
        thread_id = thread_data.get("id")
        if not isinstance(thread_id, str) or not thread_id:
            raise RuntimeError("relay-claw thread creation returned no thread id")

        message_resp = await client.post(
            "/api/messages",
            headers=headers,
            json={"content": prompt, "threadId": thread_id},
        )
        message_resp.raise_for_status()
        message_data = message_resp.json()
        invocation_id = message_data.get("invocationId")
        if not isinstance(invocation_id, str) or not invocation_id:
            status = message_data.get("status")
            if status == "queued":
                raise RuntimeError("relay-claw queued the request without an invocationId")
            raise RuntimeError("relay-claw message response returned no invocationId")

        started_at = time.monotonic()
        last_change_at = started_at
        last_status: str | None = None
        final_status: str | None = None
        final_error: str | None = None
        use_history_fallback = False
        last_history_signature: tuple[tuple[str, bool, str], ...] = ()

        while True:
            # Always check history alongside invocation to detect draft activity
            try:
                history_data = await _fetch_history(client, headers, thread_id)
                signature = _history_signature(history_data)
                assistant_messages = _assistant_final_messages(history_data)
                draft_messages = _assistant_draft_messages(history_data)
                if signature != last_history_signature:
                    last_history_signature = signature
                    last_change_at = time.monotonic()
                # If we have final assistant messages and no drafts, task is done
                if assistant_messages and not draft_messages:
                    final_status = "succeeded"
                    break
            except Exception:
                pass

            # Also check invocation status
            if not use_history_fallback:
                inv_resp = await client.get(f"/api/invocations/{invocation_id}", headers=headers)
                if inv_resp.status_code == 404:
                    use_history_fallback = True
                    continue
                inv_resp.raise_for_status()
                inv_data = inv_resp.json()
                status = inv_data.get("status")
                if not isinstance(status, str) or not status:
                    error_code = inv_data.get("code")
                    if error_code == "INVOCATION_NOT_FOUND":
                        use_history_fallback = True
                        continue
                    raise RuntimeError("relay-claw invocation response returned no status")

                if status != last_status:
                    last_status = status
                    last_change_at = time.monotonic()

                if status in {"succeeded", "failed", "canceled"}:
                    final_status = status
                    error_value = inv_data.get("error")
                    final_error = error_value if isinstance(error_value, str) else None
                    break

            now = time.monotonic()
            if now - started_at > timeout_s:
                final_status = "timeout"
                final_error = f"timeout after {timeout_s}s"
                break
            if now - last_change_at > stuck_timeout_s:
                final_status = "stuck"
                final_error = f"stuck: no activity for {stuck_timeout_s}s"
                break

            await asyncio.sleep(poll_interval_s)

        if final_status != "succeeded":
            detail = final_error or f"relay-claw invocation ended with status {final_status}"
            result["error"] = detail
            result["error_steps"] = [detail]
            return _save_result(result_dir, task_id, run_idx, result)

        history_data = await _fetch_history(client, headers, thread_id)
        assistant_messages = _assistant_final_messages(history_data)
        output_parts = [_message_text(message) for message in assistant_messages]
        output = "\n\n".join(part for part in output_parts if part)

        result = {
            "task_id": task_id,
            "status": "completed",
            "agent_output": output,
            "trajectory": _build_trajectory(assistant_messages),
        }
        return _save_result(result_dir, task_id, run_idx, result)

    except Exception as exc:
        detail = str(exc)
        result["error"] = detail
        result["error_steps"] = [detail]
        return _save_result(result_dir, task_id, run_idx, result)
    finally:
        if thread_id:
            try:
                await client.delete(f"/api/threads/{thread_id}", headers=headers)
            except Exception:
                pass
        await client.aclose()
