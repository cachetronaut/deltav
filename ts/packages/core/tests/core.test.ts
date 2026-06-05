import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Budget, SpendRequest, UsageMap } from '../src/index';
import {
  canonicalize,
  check,
  checkStack,
  emptyUsage,
  forecast,
  release,
  reserve,
  settle,
} from '../src/index';

const spendFixturePath = join(import.meta.dirname, 'conformance', 'spend', 'basic', 'request.json');
const sharedSpendFixturePath = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'conformance',
  'spend',
  'basic',
  'request.json',
);

function budget(id: string, layer: string, limits: Record<string, number>): Budget {
  return { id, layer, limits };
}

describe('check', () => {
  it('allows a request with enough cumulative headroom', () => {
    const decision = check(budget('budget_task', 'task', { model_cost_usd: 2 }), emptyUsage(), {
      estimate: { model_cost_usd: 1 },
    });

    expect(decision.ok).toBe(true);
  });

  it('denies the binding layer and dimension when a stack overflows', () => {
    const usages: UsageMap = {
      budget_org: emptyUsage(),
      budget_task: {
        ...emptyUsage(),
        cumulative: { model_cost_usd: 1.5 },
      },
    };
    const decision = checkStack(
      [
        budget('budget_org', 'org', { model_cost_usd: 10 }),
        budget('budget_task', 'task', { model_cost_usd: 2 }),
      ],
      usages,
      { estimate: { model_cost_usd: 1 } },
    );

    expect(decision).toEqual({
      ok: false,
      breach: {
        budgetId: 'budget_task',
        layer: 'task',
        dimension: 'model_cost_usd',
        limit: 2,
        wouldBe: 2.5,
      },
    });
  });

  it('rejects negative cumulative spend', () => {
    const decision = check(budget('budget_task', 'task', { model_cost_usd: 2 }), emptyUsage(), {
      estimate: { model_cost_usd: -1 },
    });

    expect(decision.ok).toBe(false);
  });
});

describe('reservation lifecycle', () => {
  it('reserves an estimate and settles the actual spend', () => {
    const usage = emptyUsage();
    const decision = check(budget('budget_task', 'task', { model_cost_usd: 2 }), usage, {
      estimate: { model_cost_usd: 2 },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      return;
    }

    const reserved = reserve(usage, { estimate: decision.reservation.estimate });
    expect(reserved.reserved.model_cost_usd).toBe(2);
    const settled = settle(reserved, decision.reservation, { model_cost_usd: 1 });
    expect(settled.cumulative.model_cost_usd).toBe(1);
    expect(settled.reserved.model_cost_usd).toBeUndefined();
  });

  it('releases a reservation without recording spend', () => {
    const usage = reserve(emptyUsage(), { estimate: { model_cost_usd: 1 } });
    const decision = check(budget('budget_task', 'task', { model_cost_usd: 2 }), emptyUsage(), {
      estimate: { model_cost_usd: 1 },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      return;
    }

    expect(release(usage, decision.reservation)).toEqual(emptyUsage());
  });

  it('tracks concurrent high-water marks', () => {
    const decision = check(budget('budget_task', 'task', { active_agents: 2 }), emptyUsage(), {
      estimate: { active_agents: 1 },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      return;
    }

    const usage = settle(
      reserve(emptyUsage(), { estimate: decision.reservation.estimate }),
      decision.reservation,
      { active_agents: 1 },
    );
    expect(usage.concurrent.active_agents).toBe(1);
    expect(usage.peak.active_agents).toBe(1);
  });

  it('forecasts without mutating usage', () => {
    const usages: UsageMap = { budget_task: emptyUsage() };
    const result = forecast([budget('budget_task', 'task', { model_cost_usd: 1 })], usages, {
      estimate: { model_cost_usd: 1 },
    });

    expect(result.decision.ok).toBe(true);
    expect(result.usages).toBe(usages);
  });
});

describe('spend conformance', () => {
  it('vendors the shared spend request fixture unchanged', () => {
    expect(readFileSync(spendFixturePath, 'utf8')).toBe(
      readFileSync(sharedSpendFixturePath, 'utf8'),
    );
  });

  it('accepts the frozen spend request shape', () => {
    const request = JSON.parse(readFileSync(spendFixturePath, 'utf8')) as SpendRequest;
    expect(canonicalize(request)).toBe(
      '{"estimate":{"tokens":1200,"usd":0.05},"runId":"run_demo_01"}',
    );
  });
});
