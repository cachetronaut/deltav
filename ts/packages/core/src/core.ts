import { defaultDimensions, dimensionKind } from './dimensions.js';
import type {
  Budget,
  BudgetStack,
  Decision,
  Dimension,
  Forecast,
  Reservation,
  Spend,
  SpendRequest,
  Usage,
  UsageMap,
} from './types.js';

let nextReservationSeq = 1;

function numberAt(values: Readonly<Record<string, number>>, key: string): number {
  return values[key] ?? 0;
}

function setIfNonZero(target: Record<string, number>, key: string, value: number): void {
  if (value !== 0) {
    target[key] = value;
  }
}

function addDelta(values: Readonly<Record<string, number>>, delta: Spend): Record<string, number> {
  const next: Record<string, number> = { ...values };
  for (const [dimension, amount] of Object.entries(delta)) {
    const value = numberAt(next, dimension) + amount;
    if (value === 0) {
      delete next[dimension];
    } else {
      next[dimension] = value;
    }
  }
  return next;
}

function reservationId(): string {
  const id = `reservation_${nextReservationSeq}`;
  nextReservationSeq += 1;
  return id;
}

export function makeReservation(estimate: Spend): Reservation {
  return {
    id: reservationId(),
    estimate: { ...estimate },
  };
}

export function emptyUsage(_dimensions: readonly Dimension[] = defaultDimensions): Usage {
  return {
    cumulative: {},
    concurrent: {},
    peak: {},
    reserved: {},
  };
}

export function check(
  budget: Budget,
  usage: Usage,
  req: SpendRequest,
  dimensions: readonly Dimension[] = defaultDimensions,
): Decision {
  for (const [dimension, amount] of Object.entries(req.estimate)) {
    const limit = budget.limits[dimension];
    if (limit === undefined) {
      continue;
    }
    const kind = dimensionKind(dimension, dimensions);
    if (kind === 'cumulative' && amount < 0) {
      return {
        ok: false,
        breach: {
          budgetId: budget.id,
          layer: budget.layer,
          dimension,
          limit: 0,
          wouldBe: amount,
        },
      };
    }
    const base =
      kind === 'concurrent'
        ? numberAt(usage.concurrent, dimension)
        : numberAt(usage.cumulative, dimension);
    const wouldBe = base + numberAt(usage.reserved, dimension) + amount;
    if (wouldBe > limit) {
      return {
        ok: false,
        breach: {
          budgetId: budget.id,
          layer: budget.layer,
          dimension,
          limit,
          wouldBe,
        },
      };
    }
    if (wouldBe < 0) {
      return {
        ok: false,
        breach: {
          budgetId: budget.id,
          layer: budget.layer,
          dimension,
          limit: 0,
          wouldBe,
        },
      };
    }
  }
  return { ok: true, reservation: makeReservation(req.estimate) };
}

export function reserve(usage: Usage, req: SpendRequest): Usage {
  return {
    ...usage,
    reserved: addDelta(usage.reserved, req.estimate),
  };
}

export function settle(
  usage: Usage,
  reservation: Reservation,
  actual: Spend,
  dimensions: readonly Dimension[] = defaultDimensions,
): Usage {
  const cumulative: Record<string, number> = { ...usage.cumulative };
  const concurrent: Record<string, number> = { ...usage.concurrent };
  const peak: Record<string, number> = { ...usage.peak };

  for (const [dimension, amount] of Object.entries(actual)) {
    const kind = dimensionKind(dimension, dimensions);
    if (kind === 'concurrent') {
      const next = numberAt(concurrent, dimension) + amount;
      setIfNonZero(concurrent, dimension, next);
      if (concurrent[dimension] === 0) {
        delete concurrent[dimension];
      }
      peak[dimension] = Math.max(numberAt(peak, dimension), next);
    } else {
      setIfNonZero(cumulative, dimension, numberAt(cumulative, dimension) + amount);
    }
  }

  return {
    cumulative,
    concurrent,
    peak,
    reserved: addDelta(usage.reserved, negate(reservation.estimate)),
  };
}

export function release(usage: Usage, reservation: Reservation): Usage {
  return {
    ...usage,
    reserved: addDelta(usage.reserved, negate(reservation.estimate)),
  };
}

export function checkStack(
  stack: BudgetStack,
  usages: UsageMap,
  req: SpendRequest,
  dimensions: readonly Dimension[] = defaultDimensions,
): Decision {
  let reservation: Reservation | undefined;
  for (const budget of stack) {
    const decision = check(budget, usages[budget.id] ?? emptyUsage(dimensions), req, dimensions);
    if (!decision.ok) {
      return decision;
    }
    reservation = decision.reservation;
  }
  return { ok: true, reservation: reservation ?? makeReservation(req.estimate) };
}

export function reserveStack(stack: BudgetStack, usages: UsageMap, req: SpendRequest): UsageMap {
  const next: Record<string, Usage> = { ...usages };
  for (const budget of stack) {
    next[budget.id] = reserve(next[budget.id] ?? emptyUsage(), req);
  }
  return next;
}

export function settleStack(
  stack: BudgetStack,
  usages: UsageMap,
  reservation: Reservation,
  actual: Spend,
  dimensions: readonly Dimension[] = defaultDimensions,
): UsageMap {
  const next: Record<string, Usage> = { ...usages };
  for (const budget of stack) {
    next[budget.id] = settle(
      next[budget.id] ?? emptyUsage(dimensions),
      reservation,
      actual,
      dimensions,
    );
  }
  return next;
}

export function releaseStack(
  stack: BudgetStack,
  usages: UsageMap,
  reservation: Reservation,
): UsageMap {
  const next: Record<string, Usage> = { ...usages };
  for (const budget of stack) {
    next[budget.id] = release(next[budget.id] ?? emptyUsage(), reservation);
  }
  return next;
}

export function forecast(stack: BudgetStack, usages: UsageMap, plan: SpendRequest): Forecast {
  return {
    decision: checkStack(stack, usages, plan),
    usages,
  };
}

function negate(spend: Spend): Spend {
  const out: Record<string, number> = {};
  for (const [dimension, amount] of Object.entries(spend)) {
    out[dimension] = -amount;
  }
  return out;
}
