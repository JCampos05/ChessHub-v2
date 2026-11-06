import { prisma } from '../../lib/prisma.js';

export interface NewPlayer {
  fullName: string;
  normalizedName: string;
  nameKey: string;
  birthDate: Date | null;
  sex: string | null;
  federation: string;
  fideId: string | null;
  nationalId: string | null;
  clubCode: string | null;
  email: string | null;
  phone: string | null;
  createdById: string;
}

export const playerRepository = {
  create(data: NewPlayer) {
    return prisma.player.create({ data });
  },

  findById(id: string) {
    return prisma.player.findUnique({ where: { id } });
  },

  findDuplicate(nameKey: string, birthDate: Date | null) {
    return prisma.player.findFirst({
      where: birthDate ? { nameKey, birthDate } : { nameKey },
      select: { id: true },
    });
  },

  async userHasRole(userId: string, roleCode: string): Promise<boolean> {
    const count = await prisma.userRole.count({ where: { userId, role: { code: roleCode } } });
    return count > 0;
  },
};
