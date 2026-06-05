from __future__ import annotations

import asyncio
from copy import deepcopy

from .core import (
    Budget,
    Decision,
    Reservation,
    Spend,
    SpendRequest,
    UsageMap,
    check_stack,
    release_stack,
    reserve_stack,
    settle_stack,
)


class InMemoryBudgetStore:
    def __init__(self, initial: dict[str, tuple[list[Budget], UsageMap]] | None = None) -> None:
        self._stacks: dict[str, tuple[list[Budget], UsageMap]] = initial or {}
        self._open: dict[str, set[str]] = {stack_id: set() for stack_id in self._stacks}
        self._lock = asyncio.Lock()

    async def load(self, stack_id: str) -> tuple[list[Budget], UsageMap]:
        async with self._lock:
            stack, usages = self._require(stack_id)
            return list(stack), deepcopy(usages)

    async def try_reserve(self, stack_id: str, req: SpendRequest) -> Decision:
        async with self._lock:
            stack, usages = self._require(stack_id)
            decision = check_stack(stack, usages, req)
            if decision.ok and decision.reservation is not None:
                self._stacks[stack_id] = (stack, reserve_stack(stack, usages, req))
                self._open.setdefault(stack_id, set()).add(decision.reservation.id)
            return decision

    async def settle(self, stack_id: str, reservation: Reservation, actual: Spend) -> None:
        async with self._lock:
            if reservation.id not in self._open.setdefault(stack_id, set()):
                return
            stack, usages = self._require(stack_id)
            self._stacks[stack_id] = (stack, settle_stack(stack, usages, reservation, actual))
            self._open[stack_id].remove(reservation.id)

    async def release(self, stack_id: str, reservation: Reservation) -> None:
        async with self._lock:
            if reservation.id not in self._open.setdefault(stack_id, set()):
                return
            stack, usages = self._require(stack_id)
            self._stacks[stack_id] = (stack, release_stack(stack, usages, reservation))
            self._open[stack_id].remove(reservation.id)

    async def snapshot(self, stack_id: str) -> UsageMap:
        async with self._lock:
            return deepcopy(self._require(stack_id)[1])

    def _require(self, stack_id: str) -> tuple[list[Budget], UsageMap]:
        if stack_id not in self._stacks:
            raise KeyError(f"Unknown budget stack: {stack_id}")
        return self._stacks[stack_id]
