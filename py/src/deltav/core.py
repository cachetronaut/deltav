from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Protocol

Spend = dict[str, float]


@dataclass(frozen=True)
class Budget:
    id: str
    layer: str
    limits: dict[str, float]


@dataclass(frozen=True)
class Usage:
    cumulative: Spend = field(default_factory=dict)
    concurrent: Spend = field(default_factory=dict)
    peak: Spend = field(default_factory=dict)
    reserved: Spend = field(default_factory=dict)


@dataclass(frozen=True)
class SpendRequest:
    estimate: Spend
    run_id: str | None = None


@dataclass(frozen=True)
class Reservation:
    id: str
    estimate: Spend


@dataclass(frozen=True)
class Breach:
    budget_id: str
    layer: str
    dimension: str
    limit: float
    would_be: float


@dataclass(frozen=True)
class Decision:
    ok: bool
    reservation: Reservation | None = None
    breach: Breach | None = None


UsageMap = dict[str, Usage]
_next_reservation = 1


class BudgetStore(Protocol):
    async def load(self, stack_id: str) -> tuple[list[Budget], UsageMap]: ...
    async def try_reserve(self, stack_id: str, req: SpendRequest) -> Decision: ...
    async def settle(self, stack_id: str, reservation: Reservation, actual: Spend) -> None: ...
    async def release(self, stack_id: str, reservation: Reservation) -> None: ...
    async def snapshot(self, stack_id: str) -> UsageMap: ...


def empty_usage() -> Usage:
    return Usage()


def check(budget: Budget, usage: Usage, req: SpendRequest) -> Decision:
    for dimension, amount in req.estimate.items():
        limit = budget.limits.get(dimension)
        if limit is None:
            continue
        if amount < 0:
            return Decision(
                ok=False,
                breach=Breach(budget.id, budget.layer, dimension, 0, amount),
            )
        would_be = usage.cumulative.get(dimension, 0) + usage.reserved.get(dimension, 0) + amount
        if would_be > limit:
            return Decision(
                ok=False,
                breach=Breach(budget.id, budget.layer, dimension, limit, would_be),
            )
    return Decision(ok=True, reservation=_reservation(req.estimate))


def check_stack(stack: list[Budget], usages: UsageMap, req: SpendRequest) -> Decision:
    reservation: Reservation | None = None
    for budget in stack:
        decision = check(budget, usages.get(budget.id, empty_usage()), req)
        if not decision.ok:
            return decision
        reservation = decision.reservation
    return Decision(ok=True, reservation=reservation or _reservation(req.estimate))


def reserve(usage: Usage, req: SpendRequest) -> Usage:
    return Usage(
        cumulative=dict(usage.cumulative),
        concurrent=dict(usage.concurrent),
        peak=dict(usage.peak),
        reserved=_add_delta(usage.reserved, req.estimate),
    )


def settle(usage: Usage, reservation: Reservation, actual: Spend) -> Usage:
    cumulative = dict(usage.cumulative)
    for dimension, amount in actual.items():
        cumulative[dimension] = cumulative.get(dimension, 0) + amount
    return Usage(
        cumulative=cumulative,
        concurrent=dict(usage.concurrent),
        peak=dict(usage.peak),
        reserved=_add_delta(usage.reserved, {k: -v for k, v in reservation.estimate.items()}),
    )


def release(usage: Usage, reservation: Reservation) -> Usage:
    return Usage(
        cumulative=dict(usage.cumulative),
        concurrent=dict(usage.concurrent),
        peak=dict(usage.peak),
        reserved=_add_delta(usage.reserved, {k: -v for k, v in reservation.estimate.items()}),
    )


def reserve_stack(stack: list[Budget], usages: UsageMap, req: SpendRequest) -> UsageMap:
    next_usages = dict(usages)
    for budget in stack:
        next_usages[budget.id] = reserve(next_usages.get(budget.id, empty_usage()), req)
    return next_usages


def settle_stack(
    stack: list[Budget], usages: UsageMap, reservation: Reservation, actual: Spend
) -> UsageMap:
    next_usages = dict(usages)
    for budget in stack:
        next_usages[budget.id] = settle(
            next_usages.get(budget.id, empty_usage()), reservation, actual
        )
    return next_usages


def release_stack(stack: list[Budget], usages: UsageMap, reservation: Reservation) -> UsageMap:
    next_usages = dict(usages)
    for budget in stack:
        next_usages[budget.id] = release(next_usages.get(budget.id, empty_usage()), reservation)
    return next_usages


def canonicalize(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=_json_default)


def _reservation(estimate: Spend) -> Reservation:
    global _next_reservation
    reservation = Reservation(id=f"reservation_{_next_reservation}", estimate=dict(estimate))
    _next_reservation += 1
    return reservation


def _add_delta(values: Spend, delta: Spend) -> Spend:
    out = dict(values)
    for dimension, amount in delta.items():
        value = out.get(dimension, 0) + amount
        if value == 0:
            out.pop(dimension, None)
        else:
            out[dimension] = value
    return out


def _json_default(value: object) -> object:
    if hasattr(value, "__dict__"):
        return value.__dict__
    raise TypeError(f"Cannot serialize {type(value)!r}")
