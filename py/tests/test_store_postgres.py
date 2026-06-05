from __future__ import annotations

import asyncio
import os
import uuid
from typing import cast

import pytest
from dockbay import create_in_memory_driver
from psycopg import AsyncConnection, sql
from psycopg_pool import AsyncConnectionPool

from deltav import Budget, DriverBudgetStore, PostgresBudgetStore, SpendRequest


def _initial() -> dict[str, tuple[list[Budget], dict]]:
    return {"default": ([Budget(id="budget_task", layer="task", limits={"model_cost_usd": 2})], {})}


@pytest.mark.asyncio
async def test_driver_budget_store_allows_only_available_headroom() -> None:
    store = DriverBudgetStore(create_in_memory_driver(), _initial())

    decisions = await asyncio.gather(
        *(store.try_reserve("default", SpendRequest({"model_cost_usd": 1})) for _ in range(5))
    )

    assert len([decision for decision in decisions if decision.ok]) == 2
    assert len([decision for decision in decisions if not decision.ok]) == 3


@pytest.mark.asyncio
async def test_driver_budget_store_ignores_duplicate_settlement() -> None:
    store = DriverBudgetStore(create_in_memory_driver(), _initial())
    decision = await store.try_reserve("default", SpendRequest({"model_cost_usd": 2}))
    assert decision.ok
    assert decision.reservation is not None

    await store.settle("default", decision.reservation, {"model_cost_usd": 1})
    await store.settle("default", decision.reservation, {"model_cost_usd": 1})

    snapshot = await store.snapshot("default")
    assert snapshot["budget_task"].cumulative["model_cost_usd"] == 1


POSTGRES_URL = os.environ.get("DELTAV_TEST_POSTGRES_URL")


@pytest.mark.skipif(POSTGRES_URL is None, reason="set DELTAV_TEST_POSTGRES_URL")
def test_postgres_budget_store_allows_only_available_headroom() -> None:
    table = f"deltav_test_{uuid.uuid4().hex}"

    async def scenario() -> None:
        url = cast(str, POSTGRES_URL)
        pool = AsyncConnectionPool(url, open=False)
        await pool.open()
        store = PostgresBudgetStore(pool, table=table, initial=_initial())
        try:
            decisions = await asyncio.gather(
                *(
                    store.try_reserve("default", SpendRequest({"model_cost_usd": 1}))
                    for _ in range(5)
                )
            )
            assert len([decision for decision in decisions if decision.ok]) == 2
            assert len([decision for decision in decisions if not decision.ok]) == 3
        finally:
            async with await AsyncConnection.connect(url) as conn:
                await conn.execute(
                    sql.SQL("DROP TABLE IF EXISTS {table}").format(table=sql.Identifier(table))
                )
                await conn.commit()
            await store.close()

    asyncio.run(scenario())
