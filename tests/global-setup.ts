import { execSync } from 'node:child_process';

const TEST_DATABASE_URL = 'postgresql://chesshub:chesshub@localhost:5432/chesshub_test';

// Aplica las migraciones a la base de pruebas antes de correr cualquier archivo
export default function setup(): void {
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
