from __future__ import annotations

import asyncio

import pytest

from deltav import Budget, InMemoryBudgetStore, SpendRequest, check, empty_usage


def test_check_denies_over_budget() -> None:
    decision = check(
        Budget(id="budget_task", layer="task", limits={"model_cost_usd": 1}),
        empty_usage(),
        SpendRequest(estimate={"model_cost_usd": 2}),
    )

    assert not decision.ok
    assert decision.breach is not None
    assert decision.breach.dimension == "model_cost_usd"


@pytest.mark.asyncio
async def test_in_memory_store_allows_only_available_headroom() -> None:
    store = InMemoryBudgetStore(
        {"default": ([Budget(id="budget_task", layer="task", limits={"model_cost_usd": 2})], {})}
    )

    decisions = await asyncio.gather(
        *(store.try_reserve("default", SpendRequest({"model_cost_usd": 1})) for _ in range(5))
    )

    assert len([decision for decision in decisions if decision.ok]) == 2
    assert len([decision for decision in decisions if not decision.ok]) == 3
