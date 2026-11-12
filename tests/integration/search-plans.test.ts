import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedBulkData } from '../helpers/bulk-data.js';
import { prisma, resetDb } from '../helpers/db.js';

// Con tablas grandes, las consultas de los listados deben apoyarse en índices y no leer toda la tabla.
// Las consultas reproducen las condiciones que generan los repositorios.

const PLAYERS = 30_000;
const TOURNAMENTS = 5_000;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}

function collect(node: PlanNode, found: PlanNode[] = []): PlanNode[] {
  found.push(node);
  for (const child of node.Plans ?? []) collect(child, found);
  return found;
}

type PlanRows = { 'QUERY PLAN': { Plan: PlanNode }[] }[];

function toNodes(rows: PlanRows): PlanNode[] {
  const root = rows[0]?.['QUERY PLAN'][0]?.Plan;
  if (!root) throw new Error('El plan de ejecución llegó vacío');
  return collect(root);
}

async function plan(sql: string): Promise<PlanNode[]> {
  return toNodes(await prisma.$queryRawUnsafe<PlanRows>(`EXPLAIN (FORMAT JSON) ${sql}`));
}

// Plan con el recorrido completo de tablas desactivado, solo dentro de esta transacción.
// Sirve para comprobar que un índice existe y es aplicable cuando el planificador elige un recorrido
// completo por ser más barato (tablas pequeñas).
async function planWithoutSeqScan(sql: string): Promise<PlanNode[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    return toNodes(await tx.$queryRawUnsafe<PlanRows>(`EXPLAIN (FORMAT JSON) ${sql}`));
  });
}

const seqScansOn = (nodes: PlanNode[], table: string) =>
  nodes.filter((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === table);

describe('planes de ejecución con tablas grandes (RNF02)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedBulkData({ players: PLAYERS, tournaments: TOURNAMENTS });
  }, 120_000);

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it('búsqueda de jugadores por texto usa el índice de trigramas', async () => {
    const nodes = await plan(`SELECT id FROM players WHERE normalized_name LIKE '%a3f9c2%' ORDER BY id LIMIT 20`);
    expect(seqScansOn(nodes, 'players')).toEqual([]);
    expect(nodes.some((node) => node['Node Type'].startsWith('Bitmap Index Scan'))).toBe(true);
  });

  it('rango de rating no recorre toda la tabla de jugadores', async () => {
    const nodes = await plan(`SELECT id FROM players WHERE rating_elo >= 2780 AND rating_elo <= 2800 ORDER BY id LIMIT 20`);
    expect(seqScansOn(nodes, 'players')).toEqual([]);
  });

  it('rango de edad (fecha de nacimiento) no recorre toda la tabla de jugadores', async () => {
    const nodes = await plan(`SELECT id FROM players WHERE birth_date <= DATE '1960-03-01' AND birth_date > DATE '1960-01-15' LIMIT 20`);
    expect(seqScansOn(nodes, 'players')).toEqual([]);
  });

  it('torneos por estado usan el índice de estado y fecha', async () => {
    const nodes = await plan(
      `SELECT id FROM tournaments WHERE status = 'IN_PROGRESS' AND is_active ORDER BY start_date DESC, id LIMIT 20`,
    );
    expect(seqScansOn(nodes, 'tournaments')).toEqual([]);
  });

  // Con 5 000 torneos el planificador prefiere recorrer la tabla (unas decenas de páginas): es lo correcto.
  // Aquí se comprueba que los índices de trigramas existen y se pueden usar para la búsqueda por texto.
  it('torneos por texto: los índices de trigramas son aplicables', async () => {
    const nodes = await planWithoutSeqScan(
      `SELECT id FROM tournaments WHERE name LIKE '%a3f9c2%' OR city LIKE '%a3f9c2%' OR venue LIKE '%a3f9c2%' LIMIT 20`,
    );
    expect(seqScansOn(nodes, 'tournaments')).toEqual([]);
    expect(nodes.filter((node) => node['Node Type'] === 'Bitmap Index Scan').length).toBeGreaterThanOrEqual(3);
  });
});
