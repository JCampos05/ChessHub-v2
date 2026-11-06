import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }),
});

const ROLES = [
  { code: 'SUPER_ADMIN', name: 'Administrador', description: 'Acceso total al sistema' },
  { code: 'FEDERATION_ADMIN', name: 'Administrador de federación', description: 'Administración nacional' },
  { code: 'STATE_ADMIN', name: 'Administrador estatal', description: 'Torneos y comités de su estado' },
  { code: 'MUNICIPAL_ADMIN', name: 'Administrador municipal', description: 'Torneos de su municipio' },
  { code: 'ORGANIZER', name: 'Organizador de torneo', description: 'Opera un torneo asignado' },
  { code: 'CHIEF_ARBITER', name: 'Árbitro principal', description: 'Genera rondas y valida resultados' },
  { code: 'ARBITER', name: 'Árbitro de mesa', description: 'Captura resultados de sus mesas' },
  { code: 'TREASURER', name: 'Tesorero', description: 'Pagos y finanzas del torneo' },
  { code: 'RATING_OFFICER', name: 'Responsable de ratings', description: 'Importa y actualiza ratings' },
  { code: 'PLAYER', name: 'Jugador', description: 'Consulta y edita su propio perfil' },
];

async function main(): Promise<void> {
  for (const role of ROLES) {
    await prisma.role.upsert({ where: { code: role.code }, update: { name: role.name, description: role.description }, create: role });
  }

  if (process.env['NODE_ENV'] === 'production') return;

  const email = 'admin@chesshub.local';
  const password = process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin12345';
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, fullName: 'Administrador de desarrollo' },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
  const existing = await prisma.userRole.findFirst({
    where: { userId: admin.id, roleId: role.id, scopeType: 'FEDERATION' },
  });
  if (!existing) {
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: role.id, scopeType: 'FEDERATION' },
    });
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
