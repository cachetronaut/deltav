import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'packages/core/src/index.ts',
    'store-convex': 'packages/store-convex/src/index.ts',
    'store-local': 'packages/store-local/src/index.ts',
    'store-postgres': 'packages/store-postgres/src/index.ts',
    'store-remote': 'packages/store-remote/src/index.ts',
  },
  format: 'esm',
  dts: true,
  splitting: true,
  clean: true,
  outDir: 'dist',
  target: 'es2022',
});
