import type { AccessEvent } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { RequestContext } from '../../shared/http.js';

interface AccessLogEntry {
  event: AccessEvent;
  userId?: string | null;
  emailAttempted?: string | null;
}

export async function logAccess(entry: AccessLogEntry, context: RequestContext): Promise<void> {
  try {
    await prisma.accessLog.create({
      data: {
        event: entry.event,
        userId: entry.userId ?? null,
        emailAttempted: entry.emailAttempted ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  } catch (error) {
    logger.error({ err: error, event: entry.event }, 'No se pudo escribir en la bitácora de accesos');
  }
}
