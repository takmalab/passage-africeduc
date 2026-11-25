import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { setProvider, OutboxProvider } from '../../src/modules/notifications/provider.js';
import { setLlmClient } from '../../src/modules/summary/llm.js';

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "AuditLog", "AiCall", "Summary", "OutboundMessage", "Anomaly", "BadgeCodeUse",
      "Passage", "Device", "DayException", "RouteStep", "Route", "SimulatedCard", "Badge",
      "ParentStudent", "Student", "Checkpoint", "Classroom", "Session", "User", "Establishment"
    CASCADE`);
  setLlmClient(undefined);
  setProvider(new OutboxProvider());
});

afterAll(async () => {
  await prisma.$disconnect();
});
