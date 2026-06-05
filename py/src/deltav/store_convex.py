from __future__ import annotations

from copy import deepcopy
from typing import Any

from dockbay import (
    ConvexOperationContext,
    ConvexOperationDriver,
    ConvexStoreOperation,
    JsonValue,
)

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

LOAD = "budget.load"
TRY_RESERVE = "budget.tryReserve"
SETTLE = "budget.settle"
RELEASE = "budget.release"
SNAPSHOT = "budget.snapshot"

InitialState = dict[str, tuple[list[Budget], UsageMap]]
_StackState = dict[str, Any]


class ConvexBudgetStore:
    def __init__(
        self,
        driver: ConvexOperationDriver,
        *,
        operations: dict[str, str] | None = None,
    ) -> None:
        self._driver = driver
        self._operations = {
            "load": LOAD,
            "try_reserve": TRY_RESERVE,
            "settle": SETTLE,
            "release": RELEASE,
            "snapshot": SNAPSHOT,
            **(operations or {}),
        }

    async def load(self, stack_id: str) -> tuple[list[Budget], UsageMap]:
        result = await self._driver.call(self._operations["load"], {"stackId": stack_id})
        assert isinstance(result, dict)
        return _row_to_stack(result), _row_to_usage_map(result["usages"])

    async def try_reserve(self, stack_id: str, req: SpendRequest) -> Decision:
        result = await self._driver.call(
            self._operations["try_reserve"],
            {"stackId": stack_id, "req": _spend_request_to_row(req)},
        )
        assert isinstance(result, dict)
        return _row_to_decision(result)

    async def settle(self, stack_id: str, reservation: Reservation, actual: Spend) -> None:
        await self._driver.call(
            self._operations["settle"],
            {
                "stackId": stack_id,
                "reservation": _reservation_to_row(reservation),
                "actual": actual,
            },
        )

    async def release(self, stack_id: str, reservation: Reservation) -> None:
        await self._driver.call(
            self._operations["release"],
            {"stackId": stack_id, "reservation": _reservation_to_row(reservation)},
        )

    async def snapshot(self, stack_id: str) -> UsageMap:
        result = await self._driver.call(self._operations["snapshot"], {"stackId": stack_id})
        return _row_to_usage_map(result)


def create_budget_operations(initial: InitialState) -> list[ConvexStoreOperation]:
    state: dict[str, _StackState] = {
        stack_id: {
            "stack": [_budget_to_row(budget) for budget in stack],
            "usages": _usage_map_to_row(usages),
            "openReservations": [],
        }
        for stack_id, (stack, usages) in initial.items()
    }

    async def load(_ctx: ConvexOperationContext, input_value: JsonValue) -> JsonValue:
        stack_id = _stack_id_from(input_value)
        current = _require_stack(state, stack_id)
        return {
            "stack": deepcopy(current["stack"]),
            "usages": deepcopy(current["usages"]),
        }

    async def try_reserve(_ctx: ConvexOperationContext, input_value: JsonValue) -> JsonValue:
        assert isinstance(input_value, dict)
        stack_id = _stack_id_from(input_value)
        current = _require_stack(state, stack_id)
        stack = _row_to_stack(current)
        usages = _row_to_usage_map(current["usages"])
        decision = check_stack(stack, usages, _row_to_spend_request(input_value["req"]))
        if not decision.ok or decision.reservation is None:
            return _decision_to_row(decision)
        state[stack_id] = {
            **current,
            "usages": _usage_map_to_row(
                reserve_stack(stack, usages, _row_to_spend_request(input_value["req"]))
            ),
            "openReservations": [*current["openReservations"], decision.reservation.id],
        }
        return _decision_to_row(decision)

    async def settle(_ctx: ConvexOperationContext, input_value: JsonValue) -> JsonValue:
        assert isinstance(input_value, dict)
        stack_id = _stack_id_from(input_value)
        current = _require_stack(state, stack_id)
        reservation = _row_to_reservation(input_value["reservation"])
        if reservation.id not in current["openReservations"]:
            return None
        stack = _row_to_stack(current)
        usages = _row_to_usage_map(current["usages"])
        state[stack_id] = {
            **current,
            "usages": _usage_map_to_row(
                settle_stack(stack, usages, reservation, input_value["actual"])
            ),
            "openReservations": [
                item for item in current["openReservations"] if item != reservation.id
            ],
        }
        return None

    async def release(_ctx: ConvexOperationContext, input_value: JsonValue) -> JsonValue:
        assert isinstance(input_value, dict)
        stack_id = _stack_id_from(input_value)
        current = _require_stack(state, stack_id)
        reservation = _row_to_reservation(input_value["reservation"])
        if reservation.id not in current["openReservations"]:
            return None
        stack = _row_to_stack(current)
        usages = _row_to_usage_map(current["usages"])
        state[stack_id] = {
            **current,
            "usages": _usage_map_to_row(release_stack(stack, usages, reservation)),
            "openReservations": [
                item for item in current["openReservations"] if item != reservation.id
            ],
        }
        return None

    async def snapshot(_ctx: ConvexOperationContext, input_value: JsonValue) -> JsonValue:
        stack_id = _stack_id_from(input_value)
        return deepcopy(_require_stack(state, stack_id)["usages"])

    return [
        ConvexStoreOperation(name=LOAD, kind="query", run=load),
        ConvexStoreOperation(name=TRY_RESERVE, kind="mutation", run=try_reserve),
        ConvexStoreOperation(name=SETTLE, kind="mutation", run=settle),
        ConvexStoreOperation(name=RELEASE, kind="mutation", run=release),
        ConvexStoreOperation(name=SNAPSHOT, kind="query", run=snapshot),
    ]


def _require_stack(state: dict[str, _StackState], stack_id: str) -> _StackState:
    try:
        return state[stack_id]
    except KeyError as exc:
        raise KeyError(f"Unknown budget stack: {stack_id}") from exc


def _stack_id_from(input_value: JsonValue) -> str:
    assert isinstance(input_value, dict)
    stack_id = input_value.get("stackId")
    if not isinstance(stack_id, str):
        raise ValueError("Convex budget operation requires stackId")
    return stack_id


def _budget_to_row(budget: Budget) -> dict[str, Any]:
    return {"id": budget.id, "layer": budget.layer, "limits": dict(budget.limits)}


def _row_to_budget(row: Any) -> Budget:
    return Budget(id=row["id"], layer=row["layer"], limits=dict(row["limits"]))


def _usage_to_row(usage: Usage) -> dict[str, Any]:
    return {
        "cumulative": dict(usage.cumulative),
        "concurrent": dict(usage.concurrent),
        "peak": dict(usage.peak),
        "reserved": dict(usage.reserved),
    }


def _row_to_usage(row: Any) -> Usage:
    return Usage(
        cumulative=dict(row["cumulative"]),
        concurrent=dict(row["concurrent"]),
        peak=dict(row["peak"]),
        reserved=dict(row["reserved"]),
    )


def _usage_map_to_row(usages: UsageMap) -> dict[str, Any]:
    return {budget_id: _usage_to_row(usage) for budget_id, usage in usages.items()}


def _row_to_usage_map(row: Any) -> UsageMap:
    return {budget_id: _row_to_usage(usage) for budget_id, usage in deepcopy(row).items()}


def _row_to_stack(row: Any) -> list[Budget]:
    return [_row_to_budget(budget) for budget in deepcopy(row["stack"])]


def _spend_request_to_row(req: SpendRequest) -> dict[str, Any]:
    return {"estimate": dict(req.estimate), "run_id": req.run_id}


def _row_to_spend_request(row: Any) -> SpendRequest:
    return SpendRequest(estimate=dict(row["estimate"]), run_id=row.get("run_id"))


def _reservation_to_row(reservation: Reservation) -> dict[str, Any]:
    return {"id": reservation.id, "estimate": dict(reservation.estimate)}


def _row_to_reservation(row: Any) -> Reservation:
    return Reservation(id=row["id"], estimate=dict(row["estimate"]))


def _decision_to_row(decision: Decision) -> dict[str, Any]:
    if decision.ok:
        assert decision.reservation is not None
        return {"ok": True, "reservation": _reservation_to_row(decision.reservation)}
    assert decision.breach is not None
    return {
        "ok": False,
        "breach": {
            "budget_id": decision.breach.budget_id,
            "layer": decision.breach.layer,
            "dimension": decision.breach.dimension,
            "limit": decision.breach.limit,
            "would_be": decision.breach.would_be,
        },
    }


def _row_to_decision(row: Any) -> Decision:
    if row["ok"]:
        return Decision(ok=True, reservation=_row_to_reservation(row["reservation"]))
    breach = row["breach"]
    from .core import Breach

    return Decision(
        ok=False,
        breach=Breach(
            budget_id=breach["budget_id"],
            layer=breach["layer"],
            dimension=breach["dimension"],
            limit=breach["limit"],
            would_be=breach["would_be"],
        ),
    )
