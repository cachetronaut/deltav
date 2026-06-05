import type { Budget, BudgetStore, Decision } from '@delta-v/core';
import { describe, expect, it } from 'vitest';

const STACK = 'contract';

function taskBudget(limit: number): Budget {
  return {
    id: 'budget_task',
    layer: 'task',
    limits: {
      model_cost_usd: limit,
      active_agents: 1,
    },
  };
}

export function runBudgetStoreContract(
  label: string,
  makeStore: () => BudgetStore,
  stackId = STACK,
): void {
  describe(`BudgetStore contract: ${label}`, () => {
    it('atomically admits only available cumulative headroom', async () => {
      const store = makeStore();
      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          store.tryReserve(stackId, { estimate: { model_cost_usd: 1 } }),
        ),
      );

      const allowed = attempts.filter((decision) => decision.ok);
      const denied = attempts.filter((decision) => !decision.ok);
      expect(allowed).toHaveLength(2);
      expect(denied).toHaveLength(3);

      for (const decision of allowed) {
        await store.settle(stackId, decision.reservation, { model_cost_usd: 1 });
      }
      const snapshot = await store.snapshot(stackId);
      expect(snapshot.budget_task?.cumulative.model_cost_usd).toBe(2);
      expect(snapshot.budget_task?.reserved.model_cost_usd).toBeUndefined();
    });

    it('releases an open reservation without recording spend', async () => {
      const store = makeStore();
      const decision = await store.tryReserve(stackId, { estimate: { model_cost_usd: 1 } });
      expect(decision.ok).toBe(true);
      if (!decision.ok) {
        return;
      }

      await store.release(stackId, decision.reservation);
      const snapshot = await store.snapshot(stackId);
      expect(snapshot.budget_task?.cumulative.model_cost_usd).toBeUndefined();
      expect(snapshot.budget_task?.reserved.model_cost_usd).toBeUndefined();
    });

    it('ignores duplicate settlement of the same reservation', async () => {
      const store = makeStore();
      const decision: Decision = await store.tryReserve(stackId, {
        estimate: { model_cost_usd: 2 },
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) {
        return;
      }

      await store.settle(stackId, decision.reservation, { model_cost_usd: 1 });
      await store.settle(stackId, decision.reservation, { model_cost_usd: 1 });
      const snapshot = await store.snapshot(stackId);
      expect(snapshot.budget_task?.cumulative.model_cost_usd).toBe(1);
    });
  });
}

export function contractInitialState(): Record<string, { stack: readonly Budget[] }> {
  return {
    [STACK]: {
      stack: [taskBudget(2)],
    },
  };
}
