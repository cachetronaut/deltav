import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@delta-v/core': fileURLToPath(new URL('packages/core/src/index.ts', import.meta.url)),
      '@delta-v/store-convex': fileURLToPath(
        new URL('packages/store-convex/src/index.ts', import.meta.url),
      ),
      '@delta-v/store-local': fileURLToPath(
        new URL('packages/store-local/src/index.ts', import.meta.url),
      ),
      '@delta-v/store-postgres': fileURLToPath(
        new URL('packages/store-postgres/src/index.ts', import.meta.url),
      ),
      '@delta-v/store-remote': fileURLToPath(
        new URL('packages/store-remote/src/index.ts', import.meta.url),
      ),
      '@delta-v/testkit': fileURLToPath(new URL('packages/testkit/src/index.ts', import.meta.url)),
      '@dockbay/convex': fileURLToPath(
        new URL('../../dockbay/ts/packages/convex/src/index.ts', import.meta.url),
      ),
      '@dockbay/core': fileURLToPath(
        new URL('../../dockbay/ts/packages/core/src/index.ts', import.meta.url),
      ),
      '@dockbay/memory': fileURLToPath(
        new URL('../../dockbay/ts/packages/memory/src/index.ts', import.meta.url),
      ),
      '@dockbay/postgres': fileURLToPath(
        new URL('../../dockbay/ts/packages/postgres/src/index.ts', import.meta.url),
      ),
    },
  },
});
