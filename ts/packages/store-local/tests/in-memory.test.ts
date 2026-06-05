import { contractInitialState, runBudgetStoreContract } from '@delta-v/testkit';
import { describe, expect, it } from 'vitest';
import { InMemoryBudgetStore } from '../src/index';

runBudgetStoreContract(
  'InMemoryBudgetStore',
  () => new InMemoryBudgetStore(contractInitialState()),
);

describe('InMemoryBudgetStore', () => {
  it('loads a cloned snapshot so callers cannot mutate store state', async () => {
    const store = new InMemoryBudgetStore(contractInitialState());
    const loaded = await store.load('contract');

    (loaded.usages as Record<string, unknown>).budget_task = {
      cumulative: { model_cost_usd: 99 },
      concurrent: {},
      peak: {},
      reserved: {},
    };

    expect((await store.snapshot('contract')).budget_task).toBeUndefined();
  });
});
