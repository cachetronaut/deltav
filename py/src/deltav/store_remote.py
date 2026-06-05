from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import cast

from .core import Breach, Budget, Decision, Reservation, Spend, SpendRequest, Usage, UsageMap

HttpRequest = Callable[[str, str, object | None], Awaitable[object]]


@dataclass(frozen=True)
class RemoteBudgetStore:
    request: HttpRequest
    default_stack_id: str

    async def load(self, stack_id: str) -> tuple[list[Budget], UsageMap]:
        body = await self.request("POST", "/budget/load", {"stackId": stack_id})
        if not isinstance(body, dict):
            raise TypeError("Remote budget load returned a non-object response")
        body_map = cast(dict[str, object], body)
        stack_value = body_map.get("stack", [])
        usages_value = body_map.get("usages", {})
        return (
            [_budget(value) for value in _list(stack_value)],
            _usage_map(usages_value),
        )

    async def try_reserve(self, stack_id: str, req: SpendRequest) -> Decision:
        body = await self.request(
            "POST", "/budget/try-reserve", {"stackId": stack_id, "request": req}
        )
        return _decision(body)

    async def settle(self, stack_id: str, reservation: Reservation, actual: Spend) -> None:
        await self.request(
            "POST",
            "/budget/settle",
            {"stackId": stack_id, "reservation": reservation, "actual": actual},
        )

    async def release(self, stack_id: str, reservation: Reservation) -> None:
        await self.request(
            "POST", "/budget/release", {"stackId": stack_id, "reservation": reservation}
        )

    async def snapshot(self, stack_id: str) -> UsageMap:
        body = await self.request("POST", "/budget/snapshot", {"stackId": stack_id})
        return _usage_map(body)


def _budget(value: object) -> Budget:
    if isinstance(value, Budget):
        return value
    if not isinstance(value, dict):
        raise TypeError("Budget value must be an object")
    value_map = cast(dict[str, object], value)
    limits = value_map["limits"]
    if not isinstance(limits, dict):
        raise TypeError("Budget limits must be an object")
    return Budget(
        id=str(value_map["id"]),
        layer=str(value_map["layer"]),
        limits={str(key): _number(amount) for key, amount in limits.items()},
    )


def _usage(value: object) -> Usage:
    if isinstance(value, Usage):
        return value
    if not isinstance(value, dict):
        raise TypeError("Usage value must be an object")
    value_map = cast(dict[str, object], value)
    return Usage(
        cumulative=_spend(value_map.get("cumulative", {})),
        concurrent=_spend(value_map.get("concurrent", {})),
        peak=_spend(value_map.get("peak", {})),
        reserved=_spend(value_map.get("reserved", {})),
    )


def _usage_map(value: object) -> UsageMap:
    if not isinstance(value, dict):
        raise TypeError("Usage map must be an object")
    value_map = cast(dict[str, object], value)
    return {str(key): _usage(item) for key, item in value_map.items()}


def _decision(value: object) -> Decision:
    if isinstance(value, Decision):
        return value
    if not isinstance(value, dict):
        raise TypeError("Decision value must be an object")
    value_map = cast(dict[str, object], value)
    if value_map.get("ok") is True:
        return Decision(ok=True, reservation=_reservation(value_map.get("reservation")))
    return Decision(ok=False, breach=_breach(value_map.get("breach")))


def _reservation(value: object) -> Reservation:
    if isinstance(value, Reservation):
        return value
    if not isinstance(value, dict):
        raise TypeError("Reservation value must be an object")
    value_map = cast(dict[str, object], value)
    return Reservation(id=str(value_map["id"]), estimate=_spend(value_map["estimate"]))


def _breach(value: object) -> Breach:
    if isinstance(value, Breach):
        return value
    if not isinstance(value, dict):
        raise TypeError("Breach value must be an object")
    value_map = cast(dict[str, object], value)
    return Breach(
        budget_id=str(value_map["budget_id"]),
        layer=str(value_map["layer"]),
        dimension=str(value_map["dimension"]),
        limit=_number(value_map["limit"]),
        would_be=_number(value_map["would_be"]),
    )


def _spend(value: object) -> Spend:
    if not isinstance(value, dict):
        raise TypeError("Spend value must be an object")
    value_map = cast(dict[str, object], value)
    return {str(key): _number(amount) for key, amount in value_map.items()}


def _list(value: object) -> list[object]:
    if not isinstance(value, list):
        raise TypeError("Value must be a list")
    return cast(list[object], value)


def _number(value: object) -> float:
    if not isinstance(value, int | float):
        raise TypeError("Value must be numeric")
    return float(value)
