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
import type {
  ConvexOperationDriver,
  ConvexStoreOperation,
  JsonValue,
} from '../../../../../dockbay/ts/packages/convex/src/index.js';

const LOAD = 'budget.load';
const TRY_RESERVE = 'budget.tryReserve';
const SETTLE = 'budget.settle';
const RELEASE = 'budget.release';
const SNAPSHOT = 'budget.snapshot';

export interface BudgetStoreInitialState {
  readonly stack: BudgetStack;
  readonly usages?: UsageMap;
}

export interface ConvexBudgetStoreOptions {
  readonly operations?: {
    readonly load?: string;
    readonly tryReserve?: string;
    readonly settle?: string;
    readonly release?: string;
    readonly snapshot?: string;
  };
}

interface PersistedStackState {
  readonly stack: BudgetStack;
  readonly usages: UsageMap;
  readonly openReservations: readonly string[];
}

interface ConvexBudgetOperationState {
  readonly stacks: Map<string, PersistedStackState>;
}

export class ConvexBudgetStore implements BudgetStore {
  private readonly operations: Required<NonNullable<ConvexBudgetStoreOptions['operations']>>;

  constructor(
    private readonly driver: ConvexOperationDriver,
    options: ConvexBudgetStoreOptions = {},
  ) {
    this.operations = {
      load: options.operations?.load ?? LOAD,
      tryReserve: options.operations?.tryReserve ?? TRY_RESERVE,
      settle: options.operations?.settle ?? SETTLE,
      release: options.operations?.release ?? RELEASE,
      snapshot: options.operations?.snapshot ?? SNAPSHOT,
    };
  }

  async load(stackId: string): Promise<{ stack: BudgetStack; usages: UsageMap }> {
    return (await this.driver.call(this.operations.load, { stackId })) as unknown as {
      stack: BudgetStack;
      usages: UsageMap;
    };
  }

  async tryReserve(stackId: string, req: SpendRequest): Promise<Decision> {
    return (await this.driver.call(this.operations.tryReserve, {
      stackId,
      req,
    } as unknown as JsonValue)) as unknown as Decision;
  }

  async settle(stackId: string, reservation: Reservation, actual: Spend): Promise<void> {
    await this.driver.call(this.operations.settle, {
      stackId,
      reservation,
      actual,
    } as unknown as JsonValue);
  }

  async release(stackId: string, reservation: Reservation): Promise<void> {
    await this.driver.call(this.operations.release, {
      stackId,
      reservation,
    } as unknown as JsonValue);
  }

  async snapshot(stackId: string): Promise<UsageMap> {
    return (await this.driver.call(this.operations.snapshot, { stackId })) as unknown as UsageMap;
  }
}

export function createBudgetOperations(
  initial: Readonly<Record<string, BudgetStoreInitialState>>,
): readonly ConvexStoreOperation[] {
  const state: ConvexBudgetOperationState = {
    stacks: new Map(
      Object.entries(initial).map(([stackId, entry]) => [
        stackId,
        {
          stack: [...entry.stack],
          usages: cloneUsageMap(entry.usages ?? {}),
          openReservations: [],
        },
      ]),
    ),
  };

  return [
    {
      name: LOAD,
      kind: 'query',
      async run(_ctx, input) {
        const stackId = stackIdFrom(input);
        const loaded = requireStack(state, stackId);
        return {
          stack: [...loaded.stack],
          usages: cloneUsageMap(loaded.usages),
        } as unknown as JsonValue;
      },
    },
    {
      name: TRY_RESERVE,
      kind: 'mutation',
      async run(_ctx, input) {
        const { stackId, req } = input as unknown as { stackId: string; req: SpendRequest };
        const current = requireStack(state, stackId);
        const decision = checkStack(current.stack, current.usages, req);
        if (!decision.ok) {
          return decision as unknown as JsonValue;
        }
        state.stacks.set(stackId, {
          ...current,
          usages: reserveStack(current.stack, current.usages, req),
          openReservations: [...current.openReservations, decision.reservation.id],
        });
        return decision as unknown as JsonValue;
      },
    },
    {
      name: SETTLE,
      kind: 'mutation',
      async run(_ctx, input) {
        const { stackId, reservation, actual } = input as unknown as {
          stackId: string;
          reservation: Reservation;
          actual: Spend;
        };
        const current = requireStack(state, stackId);
        if (!current.openReservations.includes(reservation.id)) {
          return null;
        }
        state.stacks.set(stackId, {
          ...current,
          usages: settleStack(current.stack, current.usages, reservation, actual),
          openReservations: current.openReservations.filter((id) => id !== reservation.id),
        });
        return null;
      },
    },
    {
      name: RELEASE,
      kind: 'mutation',
      async run(_ctx, input) {
        const { stackId, reservation } = input as unknown as {
          stackId: string;
          reservation: Reservation;
        };
        const current = requireStack(state, stackId);
        if (!current.openReservations.includes(reservation.id)) {
          return null;
        }
        state.stacks.set(stackId, {
          ...current,
          usages: releaseStack(current.stack, current.usages, reservation),
          openReservations: current.openReservations.filter((id) => id !== reservation.id),
        });
        return null;
      },
    },
    {
      name: SNAPSHOT,
      kind: 'query',
      async run(_ctx, input) {
        const stackId = stackIdFrom(input);
        return cloneUsageMap(requireStack(state, stackId).usages) as unknown as JsonValue;
      },
    },
  ];
}

function requireStack(state: ConvexBudgetOperationState, stackId: string): PersistedStackState {
  const stack = state.stacks.get(stackId);
  if (stack === undefined) {
    throw new Error(`Unknown budget stack: ${stackId}`);
  }
  return stack;
}

function stackIdFrom(input: JsonValue): string {
  const stackId = (input as { readonly stackId?: unknown }).stackId;
  if (typeof stackId !== 'string') {
    throw new Error('Convex budget operation requires stackId');
  }
  return stackId;
}

function cloneUsageMap(usages: UsageMap): UsageMap {
  return structuredClone(usages);
}
