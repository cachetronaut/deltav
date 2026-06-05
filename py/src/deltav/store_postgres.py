from __future__ import annotations

from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any

from dockbay import (
    PostgresStoreDriver,
    PostgresStoreDriverOptions,
    Row,
    StoreDriver,
    Transaction,
    create_postgres_driver,
)
from psycopg_pool import AsyncConnectionPool

from .core import (
    Budget,
    Decision,
    Reservation,
    Spend,
    SpendRequest,
    Usage,
    UsageMap,
    check_stack,
    release_stack,
    reserve_stack,
    settle_stack,
)

TABLE = "budget_stacks"
MAX_CAS_ATTEMPTS = 25

InitialState = dict[str, tuple[list[Budget], UsageMap]]
_Update = Callable[[Row], tuple[Any, Row]]


class DriverBudgetStore:
    def __init__(self, driver: StoreDriver, initial: InitialState | None = None) -> None:
        self._driver = driver
        self._initial = initial or {}

    async def load(self, stack_id: str) -> tuple[list[Budget], UsageMap]:
        async def work(txn: Transaction) -> tuple[list[Budget], UsageMap]:
            state = await self._load_state(txn, stack_id)
            return _row_to_stack(state), _row_to_usage_map(state["usages"])

        return await self._driver.transaction(work)

    async def try_reserve(self, stack_id: str, req: SpendRequest) -> Decision:
        def update(state: Row) -> tuple[Decision, Row]:
            stack = _row_to_stack(state)
            usages = _row_to_usage_map(state["usages"])
            decision = check_stack(stack, usages, req)
            if not decision.ok or decision.reservation is None:
                return decision, state
            next_state = {
                **state,
                "usages": _usage_map_to_row(reserve_stack(stack, usages, req)),
                "openReservations": [*state["openReservations"], decision.reservation.id],
            }
            return decision, next_state

        return await self._cas(stack_id, update)

    async def settle(self, stack_id: str, reservation: Reservation, actual: Spend) -> None:
        def update(state: Row) -> tuple[None, Row]:
            if reservation.id not in state["openReservations"]:
                return None, state
            stack = _row_to_stack(state)
            usages = _row_to_usage_map(state["usages"])
            next_state = {
                **state,
                "usages": _usage_map_to_row(settle_stack(stack, usages, reservation, actual)),
                "openReservations": [
                    item for item in state["openReservations"] if item != reservation.id
                ],
            }
            return None, next_state

        await self._cas(stack_id, update)

    async def release(self, stack_id: str, reservation: Reservation) -> None:
        def update(state: Row) -> tuple[None, Row]:
            if reservation.id not in state["openReservations"]:
                return None, state
            stack = _row_to_stack(state)
            usages = _row_to_usage_map(state["usages"])
            next_state = {
                **state,
                "usages": _usage_map_to_row(release_stack(stack, usages, reservation)),
                "openReservations": [
                    item for item in state["openReservations"] if item != reservation.id
                ],
            }
            return None, next_state

        await self._cas(stack_id, update)

    async def snapshot(self, stack_id: str) -> UsageMap:
        async def work(txn: Transaction) -> UsageMap:
            state = await self._load_state(txn, stack_id)
            return _row_to_usage_map(state["usages"])

        return await self._driver.transaction(work)

    async def close(self) -> None:
        await self._driver.close()

    async def _cas(self, stack_id: str, update: _Update) -> Any:
        for _ in range(MAX_CAS_ATTEMPTS):
            outcome = await self._driver.transaction(
                _attempt_update(stack_id, self._load_state, update)
            )
            if outcome["applied"]:
                return outcome["result"]
        raise RuntimeError(f"Budget stack update conflicted too often: {stack_id}")

    async def _load_state(self, txn: Transaction, stack_id: str) -> Row:
        existing = await txn.get(TABLE, _stack_key(stack_id))
        if existing is not None:
            return existing
        seed = self._initial.get(stack_id)
        if seed is None:
            raise KeyError(f"Unknown budget stack: {stack_id}")
        stack, usages = seed
        state = {
            "stack": [_budget_to_row(budget) for budget in stack],
            "usages": _usage_map_to_row(usages),
            "openReservations": [],
        }
        await txn.compare_and_apply(TABLE, _stack_key(stack_id), None, state)
        return state


class PostgresBudgetStore(DriverBudgetStore):
    def __init__(
        self,
        pool: AsyncConnectionPool,
        *,
        table: str = "deltav_budget_store",
        initial: InitialState | None = None,
    ) -> None:
        self.postgres_driver: PostgresStoreDriver = create_postgres_driver(
            pool, PostgresStoreDriverOptions(table=table)
        )
        super().__init__(self.postgres_driver, initial)


def _attempt_update(
    stack_id: str,
    load_state: Callable[[Transaction, str], Awaitable[Row]],
    update: _Update,
) -> Callable[[Transaction], Awaitable[Row]]:
    async def work(txn: Transaction) -> Row:
        state = await load_state(txn, stack_id)
        result, next_state = update(state)
        if state == next_state:
            return {"applied": True, "result": result}
        applied = await txn.compare_and_apply(TABLE, _stack_key(stack_id), state, next_state)
        return {"applied": applied, "result": result}

    return work


def _stack_key(stack_id: str) -> Row:
    return {"stackId": stack_id}


def _budget_to_row(budget: Budget) -> Row:
    return {"id": budget.id, "layer": budget.layer, "limits": dict(budget.limits)}


def _row_to_budget(row: Row) -> Budget:
    return Budget(id=row["id"], layer=row["layer"], limits=dict(row["limits"]))


def _usage_to_row(usage: Usage) -> Row:
    return {
        "cumulative": dict(usage.cumulative),
        "concurrent": dict(usage.concurrent),
        "peak": dict(usage.peak),
        "reserved": dict(usage.reserved),
    }


def _row_to_usage(row: Row) -> Usage:
    return Usage(
        cumulative=dict(row["cumulative"]),
        concurrent=dict(row["concurrent"]),
        peak=dict(row["peak"]),
        reserved=dict(row["reserved"]),
    )


def _usage_map_to_row(usages: UsageMap) -> Row:
    return {budget_id: _usage_to_row(usage) for budget_id, usage in usages.items()}


def _row_to_usage_map(row: Any) -> UsageMap:
    return {budget_id: _row_to_usage(usage) for budget_id, usage in deepcopy(row).items()}


def _row_to_stack(row: Row) -> list[Budget]:
    return [_row_to_budget(budget) for budget in deepcopy(row["stack"])]
