import { createMiddleware } from 'hono/factory';
import type { OrgRole, AuthContext } from '../types';
import { forbiddenError } from '../utils/errors';

export const ROLE_LEVELS: Record<OrgRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

type RbacEnv = {
  Variables: {
    auth: AuthContext;
  };
};

export function requireRole(minRole: OrgRole) {
  return createMiddleware<RbacEnv>(async (c, next) => {
    const auth = c.get('auth');
    const userLevel = ROLE_LEVELS[auth.orgRole] ?? -1;
    const requiredLevel = ROLE_LEVELS[minRole];

    if (userLevel < requiredLevel) {
      throw forbiddenError(
        `Role '${auth.orgRole}' insufficient — requires at least '${minRole}'`,
      );
    }

    return next();
  });
}
