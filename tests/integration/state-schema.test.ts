import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { prisma, resetDb } from '../helpers/db.js';

// Restricciones de base de datos del historial de estados y de las notificaciones 
describe('esquema de historial de estados y notificaciones', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  let seq = 0;
  const makeUser = () => {
    seq += 1;
    return prisma.user.create({ data: { email: `usuario${seq}@prueba.local`, passwordHash: 'no-se-usa' } });
  };

  const change = (overrides: Partial<Prisma.StateChangeUncheckedCreateInput> = {}): Prisma.StateChangeUncheckedCreateInput => ({
    entityType: 'TOURNAMENT',
    entityId: randomUUID(),
    fromState: 'REGISTRATION_OPEN',
    toState: 'REGISTRATION_CLOSED',
    ...overrides,
  });

  const notification = (
    userId: string,
    overrides: Partial<Prisma.NotificationUncheckedCreateInput> = {},
  ): Prisma.NotificationUncheckedCreateInput => ({
    userId,
    type: 'TOURNAMENT_STATE_CHANGED',
    title: 'Torneo «Abierto»: de convocatoria a inscripciones cerradas',
    body: 'Se cerraron las inscripciones.',
    dedupeKey: `state_change:${randomUUID()}`,
    ...overrides,
  });

  describe('state_changes', () => {
    it('[RF19] guarda el cambio con actor, motivo y fecha', async () => {
      const actor = await makeUser();
      const saved = await prisma.stateChange.create({
        data: change({ changedById: actor.id, reason: 'Cupo completo' }),
      });

      expect(saved.entityType).toBe('TOURNAMENT');
      expect(saved.changedById).toBe(actor.id);
      expect(saved.reason).toBe('Cupo completo');
      expect(saved.createdAt).toBeInstanceOf(Date);
    });

    it('[RF19] el actor y el motivo son opcionales', async () => {
      const saved = await prisma.stateChange.create({ data: change() });

      expect(saved.changedById).toBeNull();
      expect(saved.reason).toBeNull();
    });

    it('[RF19] rechaza un cambio al mismo estado', async () => {
      await expect(
        prisma.stateChange.create({ data: change({ fromState: 'IN_PROGRESS', toState: 'IN_PROGRESS' }) }),
      ).rejects.toThrow();
      expect(await prisma.stateChange.count()).toBe(0);
    });

    it('[RF19] el motivo admite 500 caracteres y rechaza 501', async () => {
      await expect(prisma.stateChange.create({ data: change({ reason: 'x'.repeat(500) }) })).resolves.toBeDefined();
      await expect(prisma.stateChange.create({ data: change({ reason: 'x'.repeat(501) }) })).rejects.toThrow();
      expect(await prisma.stateChange.count()).toBe(1);
    });

    it('[RF19] el actor debe existir (P2003) y un usuario con cambios no se borra', async () => {
      await expect(prisma.stateChange.create({ data: change({ changedById: randomUUID() }) })).rejects.toMatchObject({
        code: 'P2003',
      });

      const actor = await makeUser();
      await prisma.stateChange.create({ data: change({ changedById: actor.id }) });
      await expect(prisma.user.delete({ where: { id: actor.id } })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('[RF19] existe el índice por entidad y fecha descendente', async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'state_changes' AND indexname = 'state_changes_entity_type_entity_id_created_at_idx'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/created_at DESC/);
    });
  });

  describe('notifications', () => {
    it('[RF22] guarda la notificación sin leer ni enviar y con datos vacíos por omisión', async () => {
      const user = await makeUser();
      const saved = await prisma.notification.create({ data: notification(user.id) });

      expect(saved.readAt).toBeNull();
      expect(saved.emailedAt).toBeNull();
      expect(saved.data).toEqual({});
    });

    it('[RF22] guarda los datos como JSON', async () => {
      const user = await makeUser();
      const saved = await prisma.notification.create({
        data: notification(user.id, { data: { tournamentId: randomUUID(), from: 'IN_PROGRESS', to: 'FINISHED' } }),
      });

      expect(saved.data).toMatchObject({ from: 'IN_PROGRESS', to: 'FINISHED' });
    });

    it('[RF22] el mismo cambio no se guarda dos veces para el mismo usuario, pero sí para otro', async () => {
      const a = await makeUser();
      const b = await makeUser();
      const dedupeKey = 'state_change:0192f0aa-0000-7000-8000-0000000000c1';

      await prisma.notification.create({ data: notification(a.id, { dedupeKey }) });
      await expect(prisma.notification.create({ data: notification(a.id, { dedupeKey }) })).rejects.toMatchObject({
        code: 'P2002',
      });
      await expect(prisma.notification.create({ data: notification(b.id, { dedupeKey }) })).resolves.toBeDefined();
    });

    it('[RF22] createMany con skipDuplicates conserva una sola fila por usuario y cambio', async () => {
      const user = await makeUser();
      const row = notification(user.id, { dedupeKey: 'state_change:repetido' });

      const first = await prisma.notification.createMany({ data: [row], skipDuplicates: true });
      const second = await prisma.notification.createMany({ data: [row], skipDuplicates: true });

      expect(first.count).toBe(1);
      expect(second.count).toBe(0);
      expect(await prisma.notification.count()).toBe(1);
    });

    it('[RF23] rechaza un título vacío', async () => {
      const user = await makeUser();

      await expect(prisma.notification.create({ data: notification(user.id, { title: '' }) })).rejects.toThrow();
      expect(await prisma.notification.count()).toBe(0);
    });

    it('[RF22] el usuario debe existir (P2003) y un usuario con notificaciones no se borra', async () => {
      await expect(prisma.notification.create({ data: notification(randomUUID()) })).rejects.toMatchObject({
        code: 'P2003',
      });

      const user = await makeUser();
      await prisma.notification.create({ data: notification(user.id) });
      await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('[RF23] existen el índice parcial de no leídas y el de bandeja por fecha', async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'notifications'`,
      );
      const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));

      expect(byName.get('notifications_unread_idx')).toMatch(/WHERE \(read_at IS NULL\)/);
      expect(byName.get('notifications_user_id_created_at_idx')).toMatch(/created_at DESC/);
      expect(byName.get('notifications_user_id_dedupe_key_key')).toMatch(/UNIQUE/);
    });
  });

  describe('plan de ejecución con una tabla grande (RNF02)', () => {
    interface PlanNode {
      'Node Type': string;
      'Relation Name'?: string;
      'Index Name'?: string;
      Plans?: PlanNode[];
    }
    const collect = (node: PlanNode, found: PlanNode[] = []): PlanNode[] => {
      found.push(node);
      for (const child of node.Plans ?? []) collect(child, found);
      return found;
    };

    it('[RF23] contar las no leídas de un usuario usa el índice parcial y no recorre la tabla', async () => {
      const user = await makeUser();
      // 20 000 notificaciones, solo 20 sin leer: el índice parcial es claramente la mejor opción
      const total = 20_000;
      const readAt = new Date();
      await prisma.notification.createMany({
        data: Array.from({ length: total }, (_, i) =>
          notification(user.id, { dedupeKey: `state_change:masivo-${i}`, readAt: i % 1000 === 0 ? null : readAt }),
        ),
      });
      await prisma.$executeRawUnsafe('ANALYZE notifications');

      const rows = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>>(
        `EXPLAIN (FORMAT JSON) SELECT count(*) FROM notifications WHERE user_id = '${user.id}' AND read_at IS NULL`,
      );
      const root = rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (!root) throw new Error('El plan de ejecución llegó vacío');
      const nodes = collect(root);

      expect(nodes.filter((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'notifications')).toEqual([]);
      expect(nodes.some((n) => n['Index Name'] === 'notifications_unread_idx')).toBe(true);
      expect(await prisma.notification.count({ where: { userId: user.id, readAt: null } })).toBe(20);
    }, 60_000);
  });
});
