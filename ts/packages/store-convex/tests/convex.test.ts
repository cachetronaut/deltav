import { contractInitialState, runBudgetStoreContract } from '@delta-v/testkit';
import { InMemoryConvexOperationHost } from '../../../../../dockbay/ts/packages/convex/src/index.js';
import { ConvexBudgetStore, createBudgetOperations } from '../src/index.js';

runBudgetStoreContract(
  'ConvexBudgetStore',
  () =>
    new ConvexBudgetStore(
      new InMemoryConvexOperationHost(
        createBudgetOperations(contractInitialState()),
      ).createDriver(),
    ),
);
