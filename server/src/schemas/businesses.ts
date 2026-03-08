import { z } from 'zod';

export const createBusinessSchema = z.object({
  name: z.string().min(1).max(255),
  template: z.string().max(100).optional(),
});

export const deleteBusinessSchema = z.object({
  businessId: z.string().uuid(),
});

export const selectBusinessSchema = z.object({
  businessId: z.string().uuid(),
});

export const startBusinessSchema = z.object({
  sessionId: z.string().max(255).optional(),
});

export const stopBusinessSchema = z.object({
  sessionId: z.string().max(255).optional(),
});
