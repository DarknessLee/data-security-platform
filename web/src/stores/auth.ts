import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { http } from '@/api/client';

export interface ModulePerm {
  read: boolean;
  write: boolean;
}

export interface UserProfile {
  id: number;
  username: string;
  realName: string;
  deptId: number | null;
  deptName: string | null;
  jobTitle: string | null;
  roleCodes: string[];
  roleNames: string[];
  dataScope: string;
  avatarColor?: string;
  permissions: Record<string, ModulePerm>;
  platformName: string;
  version: string;
}

export interface MenuNode {
  id: number;
  name: string;
  path: string | null;
  icon: string | null;
  permission: string | null;
  type: string;
  sort: number;
  children: MenuNode[];
}

const TOKEN_KEY = 'datasec_token';
const USER_KEY = 'datasec_user';

function readUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) ?? '');
  const user = ref<UserProfile | null>(readUser());
  const menus = ref<MenuNode[]>([]);
  const unreadCount = ref(0);

  function persist(): void {
    if (token.value) localStorage.setItem(TOKEN_KEY, token.value);
    else localStorage.removeItem(TOKEN_KEY);
    if (user.value) localStorage.setItem(USER_KEY, JSON.stringify(user.value));
    else localStorage.removeItem(USER_KEY);
  }

  const isLogged = computed(() => Boolean(token.value));
  const displayName = computed(() => user.value?.realName ?? '未登录');
  const roleText = computed(() => user.value?.roleNames.join('、') ?? '');

  function canRead(code: string): boolean {
    if (!user.value) return false;
    if (user.value.roleCodes.includes('SUPER_ADMIN')) return true;
    const perm = user.value.permissions?.[code];
    return Boolean(perm?.read || perm?.write);
  }

  function canWrite(code: string): boolean {
    if (!user.value) return false;
    if (user.value.roleCodes.includes('SUPER_ADMIN')) return true;
    return Boolean(user.value.permissions?.[code]?.write);
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await http.post<{ token: string; user: UserProfile; menus: MenuNode[]; unreadCount: number }>(
      '/auth/login',
      { username, password },
    );
    token.value = res.data.token;
    user.value = res.data.user;
    menus.value = res.data.menus ?? [];
    unreadCount.value = res.data.unreadCount ?? 0;
    persist();
  }

  async function fetchProfile(): Promise<void> {
    const res = await http.get<{ user: UserProfile; menus: MenuNode[]; unreadCount: number }>('/auth/profile');
    user.value = res.data.user;
    menus.value = res.data.menus ?? [];
    unreadCount.value = res.data.unreadCount ?? 0;
    persist();
  }

  async function logout(): Promise<void> {
    try {
      await http.post('/auth/logout');
    } catch {
      /* 忽略注销接口异常 */
    }
    token.value = '';
    user.value = null;
    menus.value = [];
    unreadCount.value = 0;
    persist();
  }

  return { token, user, menus, unreadCount, isLogged, displayName, roleText, canRead, canWrite, login, fetchProfile, logout };
});
