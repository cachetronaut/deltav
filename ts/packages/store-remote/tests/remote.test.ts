import { describe, expect, it } from 'vitest';
import { InMemoryBudgetStore } from '../../store-local/src/index.js';
import { RemoteBudgetStore } from '../src/index.js';

describe('RemoteBudgetStore', () => {
  it('delegates reserve, settle, and snapshot over HTTP', async () => {
    const local = new InMemoryBudgetStore({
      default: {
        stack: [{ id: 'budget_task', layer: 'task', limits: { model_cost_usd: 1 } }],
      },
    });
    const remote = new RemoteBudgetStore({
      baseUrl: 'https://missionctrl.test',
      stackId: 'default',
      fetch: async (input, init) => {
        const url = new URL(input.toString());
        const body = JSON.parse(init?.body?.toString() ?? '{}') as {
          stackId?: string;
          request?: Parameters<InMemoryBudgetStore['tryReserve']>[1];
          reservation?: Parameters<InMemoryBudgetStore['settle']>[1];
          actual?: Parameters<InMemoryBudgetStore['settle']>[2];
        };
        if (url.pathname === '/budget/try-reserve' && body.request !== undefined) {
          return json(await local.tryReserve(body.stackId ?? 'default', body.request));
        }
        if (
          url.pathname === '/budget/settle' &&
          body.reservation !== undefined &&
          body.actual !== undefined
        ) {
          await local.settle(body.stackId ?? 'default', body.reservation, body.actual);
          return json({ ok: true });
        }
        if (url.pathname === '/budget/snapshot') {
          return json(await local.snapshot(body.stackId ?? 'default'));
        }
        return json({ error: 'not_found' }, 404);
      },
    });

    const decision = await remote.tryReserve('default', {
      runId: 'run_remote',
      estimate: { model_cost_usd: 0.5 },
    });

    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      throw new Error('expected reservation');
    }
    await remote.settle('default', decision.reservation, { model_cost_usd: 0.25 });
    expect((await remote.snapshot('default')).budget_task?.cumulative.model_cost_usd).toBe(0.25);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
