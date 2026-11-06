import { prisma } from '../../lib/prisma.js';

export const sessionRepository = {
  create(data: {
    userId: string;
    refreshTokenHash: string;
    ipAddress: string | null;
    userAgent: string | null;
    expiresAt: Date;
    absoluteExpiresAt: Date;
  }) {
    return prisma.session.create({ data });
  },

  findById(id: string) {
    return prisma.session.findUnique({ where: { id } });
  },

  async rotate(id: string, expectedHash: string, newHash: string, expiresAt: Date): Promise<number> {
    const result = await prisma.session.updateMany({
      where: { id, refreshTokenHash: expectedHash, revokedAt: null },
      data: { refreshTokenHash: newHash, expiresAt, lastUsedAt: new Date() },
    });
    return result.count;
  },

  async revoke(id: string, reason: string): Promise<void> {
    await prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },
};
