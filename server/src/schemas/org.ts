import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

export const updateOrgSchema = z.object({
  name: z.string().min(1).max(255),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).optional(),
  displayName: z.string().max(255).optional(),
});
