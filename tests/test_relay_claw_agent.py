import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from saas_bench.relay_claw_agent import run_task


@pytest.mark.asyncio
async def test_run_task_happy_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    responses = {
        ("GET", "http://localhost:3004/health"): httpx.Response(
            200, json={"status": "ok"}
        ),
        ("POST", "http://localhost:3004/api/threads"): httpx.Response(
            201, json={"id": "thread-123"}
        ),
        ("POST", "http://localhost:3004/api/messages"): httpx.Response(
            200,
            json={
                "status": "processing",
                "invocationId": "inv-123",
                "userMessageId": "msg-user",
            },
        ),
        ("GET", "http://localhost:3004/api/invocations/inv-123"): httpx.Response(
            200,
            json={"id": "inv-123", "status": "succeeded", "threadId": "thread-123"},
        ),
        ("GET", "http://localhost:3004/api/messages"): httpx.Response(
            200,
            json={
                "messages": [
                    {
                        "id": "m1",
                        "type": "assistant",
                        "content": "step one",
                        "timestamp": 1,
                    },
                    {
                        "id": "m2",
                        "type": "assistant",
                        "content": "final answer",
                        "timestamp": 2,
                    },
                ],
                "hasMore": False,
            },
        ),
        ("DELETE", "http://localhost:3004/api/threads/thread-123"): httpx.Response(
            200, json={"ok": True}
        ),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, str(request.url).split("?")[0])
        assert request.headers["x-office-claw-user"] == "saas-bench-eval"
        if key == ("GET", "http://localhost:3004/api/messages"):
            assert request.url.params["threadId"] == "thread-123"
            return responses[key]
        return responses[key]

    transport = httpx.MockTransport(handler)

    async def client_factory(*args, **kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setenv("RELAY_CLAW_USER", "saas-bench-eval")
    monkeypatch.setenv("RELAY_CLAW_POLL_INTERVAL", "0")
    monkeypatch.setattr(
        "saas_bench.relay_claw_agent._build_async_client", client_factory
    )

    task = {"task_id": "demo_task"}
    result = await run_task(task, "dummy-model", "do the task", str(tmp_path), run_idx=0)

    assert result["task_id"] == "demo_task"
    assert result["status"] == "completed"
    assert result["agent_output"] == "step one\n\nfinal answer"
    assert len(result["trajectory"]) == 2
    assert result["trajectory"][0]["role"] == "assistant"
    saved = json.loads((tmp_path / "demo_task_r0.json").read_text())
    assert saved["status"] == "completed"


@pytest.mark.asyncio
async def test_run_task_sends_bearer_session_when_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    responses = {
        ("GET", "http://localhost:3004/health"): httpx.Response(
            200, json={"status": "ok"}
        ),
        ("POST", "http://localhost:3004/api/threads"): httpx.Response(
            201, json={"id": "thread-auth"}
        ),
        ("POST", "http://localhost:3004/api/messages"): httpx.Response(
            200,
            json={"status": "processing", "invocationId": "inv-auth"},
        ),
        ("GET", "http://localhost:3004/api/invocations/inv-auth"): httpx.Response(
            200, json={"id": "inv-auth", "status": "succeeded"}
        ),
        ("GET", "http://localhost:3004/api/messages"): httpx.Response(
            200,
            json={
                "messages": [
                    {
                        "id": "m-auth",
                        "type": "assistant",
                        "content": "authorized answer",
                        "timestamp": 1,
                    }
                ],
                "hasMore": False,
            },
        ),
        ("DELETE", "http://localhost:3004/api/threads/thread-auth"): httpx.Response(
            200, json={"ok": True}
        ),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer sess-123"
        assert request.headers["x-office-claw-session"] == "sess-123"
        return responses[(request.method, str(request.url).split("?")[0])]

    transport = httpx.MockTransport(handler)

    async def client_factory(*args, **kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setenv("RELAY_CLAW_USER", "saas-bench-eval")
    monkeypatch.setenv("RELAY_CLAW_SESSION_ID", "sess-123")
    monkeypatch.setenv("RELAY_CLAW_POLL_INTERVAL", "0")
    monkeypatch.setattr(
        "saas_bench.relay_claw_agent._build_async_client", client_factory
    )

    result = await run_task({"task_id": "auth_task"}, "dummy", "prompt", str(tmp_path))

    assert result["status"] == "completed"
    assert result["agent_output"] == "authorized answer"


@pytest.mark.asyncio
async def test_run_task_returns_error_when_health_check_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(503, json={"status": "down"})
    )

    async def client_factory(*args, **kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setenv("RELAY_CLAW_POLL_INTERVAL", "0")
    monkeypatch.setattr(
        "saas_bench.relay_claw_agent._build_async_client", client_factory
    )

    result = await run_task({"task_id": "health_fail"}, "dummy", "prompt", str(tmp_path))

    assert result["status"] == "error"
    assert "relay-claw not available" in " ".join(result.get("error_steps", []))
    saved = json.loads((tmp_path / "health_fail.json").read_text())
    assert saved["status"] == "error"


@pytest.mark.asyncio
async def test_run_task_returns_error_when_invocation_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sequence = {
        ("GET", "http://localhost:3004/health"): httpx.Response(
            200, json={"status": "ok"}
        ),
        ("POST", "http://localhost:3004/api/threads"): httpx.Response(
            201, json={"id": "thread-err"}
        ),
        ("POST", "http://localhost:3004/api/messages"): httpx.Response(
            200,
            json={"status": "processing", "invocationId": "inv-err"},
        ),
        ("GET", "http://localhost:3004/api/invocations/inv-err"): httpx.Response(
            200,
            json={"id": "inv-err", "status": "failed", "error": "agent crashed"},
        ),
        ("DELETE", "http://localhost:3004/api/threads/thread-err"): httpx.Response(
            200, json={"ok": True}
        ),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return sequence[(request.method, str(request.url).split("?")[0])]

    transport = httpx.MockTransport(handler)

    async def client_factory(*args, **kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setenv("RELAY_CLAW_POLL_INTERVAL", "0")
    monkeypatch.setattr(
        "saas_bench.relay_claw_agent._build_async_client", client_factory
    )

    result = await run_task({"task_id": "inv_fail"}, "dummy", "prompt", str(tmp_path))

    assert result["status"] == "error"
    assert "agent crashed" in result.get("error", "")
    assert result["error_steps"] == ["agent crashed"]
    saved = json.loads((tmp_path / "inv_fail.json").read_text())
    assert saved["status"] == "error"


@pytest.mark.asyncio
async def test_run_task_falls_back_to_message_history_when_invocation_is_not_found(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    history_calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, str(request.url).split("?")[0])
        if key == ("GET", "http://localhost:3004/health"):
            return httpx.Response(200, json={"status": "ok"})
        if key == ("POST", "http://localhost:3004/api/threads"):
            return httpx.Response(201, json={"id": "thread-fallback"})
        if key == ("POST", "http://localhost:3004/api/messages"):
            return httpx.Response(
                200,
                json={"status": "processing", "invocationId": "inv-missing"},
            )
        if key == ("GET", "http://localhost:3004/api/invocations/inv-missing"):
            return httpx.Response(
                404,
                json={"error": "Invocation not found", "code": "INVOCATION_NOT_FOUND"},
            )
        if key == ("GET", "http://localhost:3004/api/messages"):
            history_calls["count"] += 1
            if history_calls["count"] == 1:
                return httpx.Response(
                    200,
                    json={
                        "messages": [
                            {
                                "id": "u1",
                                "type": "user",
                                "content": "prompt",
                                "timestamp": 1,
                            },
                            {
                                "id": "draft-1",
                                "type": "assistant",
                                "content": "working",
                                "timestamp": 2,
                                "isDraft": True,
                            },
                        ],
                        "hasMore": False,
                    },
                )
            return httpx.Response(
                200,
                json={
                    "messages": [
                        {
                            "id": "u1",
                            "type": "user",
                            "content": "prompt",
                            "timestamp": 1,
                        },
                        {
                            "id": "m-final",
                            "type": "assistant",
                            "content": "done",
                            "timestamp": 3,
                            "origin": "stream",
                        },
                    ],
                    "hasMore": False,
                },
            )
        if key == ("DELETE", "http://localhost:3004/api/threads/thread-fallback"):
            return httpx.Response(200, json={"ok": True})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    transport = httpx.MockTransport(handler)

    async def client_factory(*args, **kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setenv("RELAY_CLAW_POLL_INTERVAL", "0")
    monkeypatch.setenv("RELAY_CLAW_STUCK_TIMEOUT", "5")
    monkeypatch.setattr(
        "saas_bench.relay_claw_agent._build_async_client", client_factory
    )

    result = await run_task({"task_id": "fallback_task"}, "dummy", "prompt", str(tmp_path))

    assert result["status"] == "completed"
    assert result["agent_output"] == "done"
    assert history_calls["count"] >= 2
    saved = json.loads((tmp_path / "fallback_task.json").read_text())
    assert saved["status"] == "completed"


@pytest.mark.asyncio
async def test_run_task_adds_browser_guardrail_for_web_ui_tasks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, str(request.url).split("?")[0])
        if key == ("GET", "http://localhost:3004/health"):
            return httpx.Response(200, json={"status": "ok"})
        if key == ("POST", "http://localhost:3004/api/threads"):
            return httpx.Response(201, json={"id": "thread-guardrail"})
        if key == ("POST", "http://localhost:3004/api/messages"):
            payload = json.loads(request.content.decode("utf-8"))
            captured["content"] = payload["content"]
            return httpx.Response(
                200,
                json={"status": "processing", "invocationId": "inv-guardrail"},
            )
        if key == ("GET", "http://localhost:3004/api/invocations/inv-guardrail"):
            return httpx.Response(200, json={"id": "inv-guardrail", "status": "succeeded"})
        if key == ("GET", "http://localhost:3004/api/messages"):
            return httpx.Response(
                200,
                json={
                    "messages": [
                        {
                            "id": "m1",
                            "type": "assistant",
                            "content": "done",
                            "timestamp": 1,
                        }
                    ],
                    "hasMore": False,
                },
            )
        if key == ("DELETE", "http://localhost:3004/api/threads/thread-guardrail"):
            return httpx.Response(200, json={"ok": True})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    transport = httpx.MockTransport(handler)

    async def client_factory(*args, **kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, base_url="http://localhost:3004")

    monkeypatch.setenv("RELAY_CLAW_API_URL", "http://localhost:3004")
    monkeypatch.setenv("RELAY_CLAW_POLL_INTERVAL", "0")
    monkeypatch.setattr(
        "saas_bench.relay_claw_agent._build_async_client", client_factory
    )

    prompt = (
        "Use these exact URLs.\n"
        "code-server: http://localhost:30000\n"
        "baserow: http://localhost:30003\n"
        "openproject: http://localhost:30001\n"
        "After landing on an app, navigate within it via UI clicks only."
    )
    result = await run_task({"task_id": "guardrail_task"}, "dummy", prompt, str(tmp_path))

    assert result["status"] == "completed"
    assert "Execution policy for this task" in captured["content"]
    assert prompt in captured["content"]
