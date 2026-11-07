export interface ModulePerm {
  read: boolean;
  write: boolean;
}

export interface AuthUser {
  id: number;
  username: string;
  realName: string;
  deptId: number | null;
  deptName: string | null;
  jobTitle: string | null;
  roleCodes: string[];
  roleNames: string[];
  dataScope: 'ALL' | 'DEPT' | 'SELF' | 'CUSTOM';
  perms: Record<string, ModulePerm>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      auditAction?: string;
      auditResource?: string;
      auditDetail?: string;
    }
  }
}
