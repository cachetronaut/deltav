import type {
  BudgetStack,
  BudgetStore,
  Decision,
  Reservation,
  Spend,
  SpendRequest,
  UsageMap,
} from '@delta-v/core';

export interface RemoteBudgetStoreOptions {
  readonly baseUrl: string;
  readonly stackId: string;
  readonly fetch?: typeof fetch;
}

export class RemoteBudgetStore implements BudgetStore {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RemoteBudgetStoreOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async load(stackId = this.options.stackId): Promise<{ stack: BudgetStack; usages: UsageMap }> {
    return this.post('/budget/load', { stackId });
  }

  async tryReserve(stackId: string, request: SpendRequest): Promise<Decision> {
    return this.post('/budget/try-reserve', { stackId, request });
  }

  async settle(stackId: string, reservation: Reservation, actual: Spend): Promise<void> {
    await this.post('/budget/settle', { stackId, reservation, actual });
  }

  async release(stackId: string, reservation: Reservation): Promise<void> {
    await this.post('/budget/release', { stackId, reservation });
  }

  async snapshot(stackId = this.options.stackId): Promise<UsageMap> {
    return this.post('/budget/snapshot', { stackId });
  }

  private async post<T>(pathname: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Remote budget request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
