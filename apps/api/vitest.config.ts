import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@atoms-cp/codegen': fileURLToPath(new URL('../../packages/codegen/src/index.ts', import.meta.url)),
      '@atoms-cp/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts']
  }
});
