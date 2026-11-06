import { prisma } from '../../lib/prisma.js';

export const userRepository = {
  create(data: { email: string; passwordHash: string; fullName?: string | undefined }) {
    return prisma.user.create({
      data: { email: data.email, passwordHash: data.passwordHash, fullName: data.fullName ?? null },
    });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  findRoles(userId: string) {
    return prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async registerFailedAttempt(userId: string): Promise<number> {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    return updated.failedLoginAttempts;
  },

  lock(userId: string, until: Date) {
    return prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: until, failedLoginAttempts: 0 },
    });
  },

  clearFailures(userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  },
};
