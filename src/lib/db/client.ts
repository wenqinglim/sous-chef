/**
 * Prisma client singleton.
 *
 * Next.js dev hot-reload re-evaluates modules; stashing the client on
 * globalThis prevents exhausting the connection pool with stale clients.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
