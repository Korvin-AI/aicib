export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface AuthContext {
  userId: string | null;
  orgId: string;
  orgRole: OrgRole;
}

export interface TenantContext extends AuthContext {
  businessId: string;
}
