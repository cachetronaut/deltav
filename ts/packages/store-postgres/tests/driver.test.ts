import { contractInitialState, runBudgetStoreContract } from '@delta-v/testkit';
import { createInMemoryDriver } from '../../../../../dockbay/ts/packages/memory/src/index.js';
import { DriverBudgetStore } from '../src/index.js';

runBudgetStoreContract(
  'DriverBudgetStore',
  () => new DriverBudgetStore(createInMemoryDriver(), contractInitialState()),
);
