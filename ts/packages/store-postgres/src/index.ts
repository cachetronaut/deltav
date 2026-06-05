import {
  type BudgetStack,
  type BudgetStore,
  checkStack,
  type Decision,
  type Reservation,
  releaseStack,
  reserveStack,
  type Spend,
  type SpendRequest,
  settleStack,
  type UsageMap,
} from '@delta-v/core';
import type { Pool } from 'pg';
import type {
  Row,
  StoreDriver,
  Transaction,
} from '../../../../../dockbay/ts/packages/core/src/index.js';
import {
  createPostgresDriver,
  type PostgresStoreDriver,
} from '../../../../../dockbay/ts/packages/postgres/src/index.js';

const TABLE = 'budget_stacks';
const MAX_CAS_ATTEMPTS = 25;

export interface BudgetStoreInitialState {
  readonly stack: BudgetStack;
  readonly usages?: UsageMap;
}

export interface DriverBudgetStoreOptions {
  readonly initial?: Readonly<Record<string, BudgetStoreInitialState>>;
}

export interface PostgresBudgetStoreOptions extends DriverBudgetStoreOptions {
  readonly table?: string;
}

interface PersistedStackState extends Row {
  readonly stack: BudgetStack;
  readonly usages: UsageMap;
  readonly openReservations: readonly string[];
}

export class DriverBudgetStore implements BudgetStore {
  constructor(
    private readonly driver: StoreDriver,
    private readonly initial: Readonly<Record<string, BudgetStoreInitialState>> = {},
  ) {}

  async load(stackId: string): Promise<{ stack: BudgetStack; usages: UsageMap }> {
    return this.driver.transaction(async (txn) => {
      const state = await this.loadState(txn, stackId);
      return { stack: [...state.stack], usages: cloneUsageMap(state.usages) };
    });
  }

  async tryReserve(stackId: string, req: SpendRequest): Promise<Decision> {
    return this.cas<Decision>(stackId, (state) => {
      const decision = checkStack(state.stack, state.usages, req);
      if (!decision.ok) {
        return { result: decision, next: state };
      }
      return {
        result: decision,
        next: {
          ...state,
          usages: reserveStack(state.stack, state.usages, req),
          openReservations: [...state.openReservations, decision.reservation.id],
        },
      };
    });
  }

  async settle(stackId: string, reservation: Reservation, actual: Spend): Promise<void> {
    await this.cas(stackId, (state) => {
      if (!state.openReservations.includes(reservation.id)) {
        return { result: undefined, next: state };
      }
      return {
        result: undefined,
        next: {
          ...state,
          usages: settleStack(state.stack, state.usages, reservation, actual),
          openReservations: state.openReservations.filter((id) => id !== reservation.id),
        },
      };
    });
  }

  async release(stackId: string, reservation: Reservation): Promise<void> {
    await this.cas(stackId, (state) => {
      if (!state.openReservations.includes(reservation.id)) {
        return { result: undefined, next: state };
      }
      return {
        result: undefined,
        next: {
          ...state,
          usages: releaseStack(state.stack, state.usages, reservation),
          openReservations: state.openReservations.filter((id) => id !== reservation.id),
        },
      };
    });
  }

  async snapshot(stackId: string): Promise<UsageMap> {
    return this.driver.transaction(async (txn) => {
      const state = await this.loadState(txn, stackId);
      return cloneUsageMap(state.usages);
    });
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private async cas<T>(
    stackId: string,
    update: (state: PersistedStackState) => { result: T; next: PersistedStackState },
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const outcome = await this.driver.transaction(async (txn) => {
        const state = await this.loadState(txn, stackId);
        const { result, next } = update(state);
        if (sameState(state, next)) {
          return { applied: true, result };
        }
        const applied = await txn.compareAndApply(TABLE, stackKey(stackId), state, next);
        return { applied, result };
      });
      if (outcome.applied) {
        return outcome.result;
      }
    }
    throw new Error(`Budget stack update conflicted too often: ${stackId}`);
  }

  private async loadState(txn: Transaction, stackId: string): Promise<PersistedStackState> {
    const existing = await txn.get(TABLE, stackKey(stackId));
    if (existing !== undefined) {
      return existing as PersistedStackState;
    }
    const seed = this.initial[stackId];
    if (seed === undefined) {
      throw new Error(`Unknown budget stack: ${stackId}`);
    }
    const state: PersistedStackState = {
      stack: [...seed.stack],
      usages: cloneUsageMap(seed.usages ?? {}),
      openReservations: [],
    };
    await txn.compareAndApply(TABLE, stackKey(stackId), undefined, state);
    return state;
  }
}

export class PostgresBudgetStore extends DriverBudgetStore {
  readonly postgresDriver: PostgresStoreDriver;

  constructor(pool: Pool, options: PostgresBudgetStoreOptions = {}) {
    const driver = createPostgresDriver(pool, { table: options.table });
    super(driver, options.initial);
    this.postgresDriver = driver;
  }
}

function stackKey(stackId: string): Row {
  return { stackId };
}

function cloneUsageMap(usages: UsageMap): UsageMap {
  return structuredClone(usages);
}

function sameState(left: PersistedStackState, right: PersistedStackState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
