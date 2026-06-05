import { randomUUID } from 'node:crypto';
import { contractInitialState, runBudgetStoreContract } from '@delta-v/testkit';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe } from 'vitest';
import { PostgresBudgetStore } from '../src/index.js';

const POSTGRES_URL = process.env.DELTAV_TEST_POSTGRES_URL;

describe.skipIf(POSTGRES_URL === undefined)('PostgresBudgetStore', () => {
  let pool: Pool;
  let table: string;

  beforeAll(() => {
    table = `deltav_test_${randomUUID().replaceAll('-', '_')}`;
    pool = new Pool({ connectionString: POSTGRES_URL });
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "${table}"`);
    await pool.end();
  });

  runBudgetStoreContract(
    'PostgresBudgetStore',
    () => new PostgresBudgetStore(pool, { table, initial: contractInitialState() }),
  );
});
