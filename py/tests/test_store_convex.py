from __future__ import annotations

import asyncio

import pytest
from dockbay import InMemoryConvexOperationHost

from deltav import Budget, ConvexBudgetStore, SpendRequest, create_budget_operations


def _initial() -> dict[str, tuple[list[Budget], dict]]:
    return {"default": ([Budget(id="budget_task", layer="task", limits={"model_cost_usd": 2})], {})}


@pytest.mark.asyncio
async def test_convex_budget_store_allows_only_available_headroom() -> None:
    store = ConvexBudgetStore(
        InMemoryConvexOperationHost(create_budget_operations(_initial())).create_driver()
    )

    decisions = await asyncio.gather(
        *(store.try_reserve("default", SpendRequest({"model_cost_usd": 1})) for _ in range(5))
    )

    assert len([decision for decision in decisions if decision.ok]) == 2
    assert len([decision for decision in decisions if not decision.ok]) == 3


@pytest.mark.asyncio
async def test_convex_budget_store_ignores_duplicate_settlement() -> None:
    store = ConvexBudgetStore(
        InMemoryConvexOperationHost(create_budget_operations(_initial())).create_driver()
    )
    decision = await store.try_reserve("default", SpendRequest({"model_cost_usd": 2}))
    assert decision.ok
    assert decision.reservation is not None

    await store.settle("default", decision.reservation, {"model_cost_usd": 1})
    await store.settle("default", decision.reservation, {"model_cost_usd": 1})

    snapshot = await store.snapshot("default")
    assert snapshot["budget_task"].cumulative["model_cost_usd"] == 1
