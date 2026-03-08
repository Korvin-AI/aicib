import { z } from 'zod';

export const updateSettingsSchema = z.object({
  config: z.record(z.unknown()).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
