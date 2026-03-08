export interface AuthContext {
  userId: string | null;
  orgId: string;
  orgRole: string;
}

export interface TenantContext extends AuthContext {
  businessId: string;
}
