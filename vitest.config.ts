import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Las pruebas de integración comparten una sola base de datos real (C-40).
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://chesshub:chesshub@localhost:5432/chesshub_test',
      JWT_SECRET: 'secreto-de-pruebas-con-mas-de-32-caracteres',
      BCRYPT_COST: '4',
      REDIS_URL: '',
      // Reintentos cortos para que las pruebas de la cola no esperen segundos
      NOTIFICATION_ATTEMPTS: '3',
      NOTIFICATION_BACKOFF_MS: '1',
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/generated/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
