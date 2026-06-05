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

interface StackState {
  readonly stack: BudgetStack;
  usages: UsageMap;
  readonly openReservations: Set<string>;
}

export class InMemoryBudgetStore implements BudgetStore {
  private readonly stacks = new Map<string, StackState>();
  private lock: Promise<void> = Promise.resolve();

  constructor(initial: Readonly<Record<string, { stack: BudgetStack; usages?: UsageMap }>> = {}) {
    for (const [stackId, state] of Object.entries(initial)) {
      this.stacks.set(stackId, {
        stack: [...state.stack],
        usages: state.usages ?? {},
        openReservations: new Set(),
      });
    }
  }

  async load(stackId: string): Promise<{ stack: BudgetStack; usages: UsageMap }> {
    return this.withLock(async () => {
      const state = this.requireStack(stackId);
      return {
        stack: [...state.stack],
        usages: cloneUsageMap(state.usages),
      };
    });
  }

  async tryReserve(stackId: string, req: SpendRequest): Promise<Decision> {
    return this.withLock(async () => {
      const state = this.requireStack(stackId);
      const decision = checkStack(state.stack, state.usages, req);
      if (decision.ok) {
        state.usages = reserveStack(state.stack, state.usages, req);
        state.openReservations.add(decision.reservation.id);
      }
      return decision;
    });
  }

  async settle(stackId: string, reservation: Reservation, actual: Spend): Promise<void> {
    await this.withLock(async () => {
      const state = this.requireStack(stackId);
      if (!state.openReservations.has(reservation.id)) {
        return;
      }
      state.usages = settleStack(state.stack, state.usages, reservation, actual);
      state.openReservations.delete(reservation.id);
    });
  }

  async release(stackId: string, reservation: Reservation): Promise<void> {
    await this.withLock(async () => {
      const state = this.requireStack(stackId);
      if (!state.openReservations.has(reservation.id)) {
        return;
      }
      state.usages = releaseStack(state.stack, state.usages, reservation);
      state.openReservations.delete(reservation.id);
    });
  }

  async snapshot(stackId: string): Promise<UsageMap> {
    return this.withLock(async () => cloneUsageMap(this.requireStack(stackId).usages));
  }

  private requireStack(stackId: string): StackState {
    const state = this.stacks.get(stackId);
    if (state === undefined) {
      throw new Error(`Unknown budget stack: ${stackId}`);
    }
    return state;
  }

  private async withLock<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.lock;
    let releaseLock: () => void = () => {};
    this.lock = new Promise((resolve) => {
      releaseLock = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      releaseLock();
    }
  }
}

function cloneUsageMap(usages: UsageMap): UsageMap {
  return structuredClone(usages);
}
