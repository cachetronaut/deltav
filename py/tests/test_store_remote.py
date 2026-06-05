from __future__ import annotations

import asyncio
from typing import cast

from deltav import Budget, InMemoryBudgetStore, RemoteBudgetStore, Reservation, SpendRequest


def test_remote_budget_store_delegates_to_http_surface() -> None:
    asyncio.run(_assert_remote_budget_store_delegates_to_http_surface())


async def _assert_remote_budget_store_delegates_to_http_surface() -> None:
    local = InMemoryBudgetStore(
        {
            "default": (
                [Budget(id="budget_task", layer="task", limits={"model_cost_usd": 1})],
                {},
            )
        }
    )

    async def request(method: str, path: str, body: object | None) -> object:
        assert method == "POST"
        assert isinstance(body, dict)
        body_map = cast(dict[str, object], body)
        stack_id = body_map.get("stackId", "default")
        assert isinstance(stack_id, str)
        if path == "/budget/try-reserve":
            request_value = body_map.get("request")
            assert isinstance(request_value, SpendRequest)
            return await local.try_reserve(stack_id, request_value)
        if path == "/budget/settle":
            reservation = body_map.get("reservation")
            actual = body_map.get("actual")
            assert isinstance(reservation, Reservation)
            assert isinstance(actual, dict)
            actual_map = cast(dict[str, float], actual)
            await local.settle(stack_id, reservation, actual_map)
            return {"ok": True}
        if path == "/budget/snapshot":
            return await local.snapshot(stack_id)
        raise RuntimeError(path)

    remote = RemoteBudgetStore(request=request, default_stack_id="default")

    decision = await remote.try_reserve(
        "default", SpendRequest({"model_cost_usd": 0.5}, run_id="run_remote")
    )
    assert decision.ok
    assert decision.reservation is not None

    await remote.settle("default", decision.reservation, {"model_cost_usd": 0.25})
    usage = await remote.snapshot("default")
    assert usage["budget_task"].cumulative["model_cost_usd"] == 0.25
