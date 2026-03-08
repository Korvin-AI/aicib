import { z } from 'zod';

export const initSetupSchema = z.object({
  name: z.string().min(1).max(255),
  template: z.string().max(100).optional(),
  config: z.record(z.unknown()).optional(),
});

export const startSetupSchema = z.object({
  sessionId: z.string().max(255).optional(),
});
