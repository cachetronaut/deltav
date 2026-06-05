export type RunId = string;
export type ReservationId = string;

export type DimensionKind = 'cumulative' | 'concurrent';

export interface Dimension {
  readonly name: string;
  readonly kind: DimensionKind;
}

export interface Budget {
  readonly id: string;
  readonly layer: string;
  readonly limits: Readonly<Record<string, number>>;
}

export interface Usage {
  readonly cumulative: Readonly<Record<string, number>>;
  readonly concurrent: Readonly<Record<string, number>>;
  readonly peak: Readonly<Record<string, number>>;
  readonly reserved: Readonly<Record<string, number>>;
}

export type Spend = Readonly<Record<string, number>>;

export interface SpendRequest {
  readonly runId?: RunId;
  readonly estimate: Spend;
}

export interface Reservation {
  readonly id: ReservationId;
  readonly estimate: Spend;
}

export interface Breach {
  readonly budgetId: string;
  readonly layer: string;
  readonly dimension: string;
  readonly limit: number;
  readonly wouldBe: number;
}

export type Decision =
  | { readonly ok: true; readonly reservation: Reservation }
  | { readonly ok: false; readonly breach: Breach };

export type BudgetStack = readonly Budget[];
export type UsageMap = Readonly<Record<string, Usage>>;

export interface Forecast {
  readonly decision: Decision;
  readonly usages: UsageMap;
}

export interface BudgetStore {
  load(stackId: string): Promise<{ stack: BudgetStack; usages: UsageMap }>;
  tryReserve(stackId: string, req: SpendRequest): Promise<Decision>;
  settle(stackId: string, reservation: Reservation, actual: Spend): Promise<void>;
  release(stackId: string, reservation: Reservation): Promise<void>;
  snapshot(stackId: string): Promise<UsageMap>;
}
