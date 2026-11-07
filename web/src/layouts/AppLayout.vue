<template>
  <el-container class="app-shell">
    <el-aside :width="collapsed ? '64px' : '220px'" class="app-aside">
      <div class="brand">
        <div class="brand-logo">安</div>
        <div v-show="!collapsed" class="brand-text">
          <strong>数据安全治理</strong>
          <span>与服务保障平台</span>
        </div>
      </div>
      <el-scrollbar class="menu-scroll">
        <el-menu
          :default-active="activePath"
          :collapse="collapsed"
          :collapse-transition="false"
          background-color="#0f1b2d"
          text-color="#a9b7cc"
          active-text-color="#ffffff"
          router
        >
          <template v-for="item in navMenus" :key="item.id">
            <el-sub-menu v-if="item.children?.length" :index="item.path ?? String(item.id)">
              <template #title>
                <el-icon><component :is="iconOf(item.icon)" /></el-icon>
                <span>{{ item.name }}</span>
              </template>
              <el-menu-item v-for="child in item.children" :key="child.id" :index="child.path ?? ''">
                <el-icon><component :is="iconOf(child.icon)" /></el-icon>
                <span>{{ child.name }}</span>
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item v-else :index="item.path ?? ''">
              <el-icon><component :is="iconOf(item.icon)" /></el-icon>
              <span>{{ item.name }}</span>
            </el-menu-item>
          </template>
        </el-menu>
      </el-scrollbar>
    </el-aside>

    <el-container class="app-body">
      <el-header class="app-header">
        <div class="header-left">
          <el-button text class="collapse-btn" @click="collapsed = !collapsed">
            <el-icon><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
          </el-button>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="parentTitle">{{ parentTitle }}</el-breadcrumb-item>
            <el-breadcrumb-item v-if="route.meta.title">{{ route.meta.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <span class="header-time">{{ clock }}</span>
          <el-popover placement="bottom-end" :width="360" trigger="click" @show="loadNotices">
            <template #reference>
              <el-badge :value="unreadCount" :hidden="!unreadCount" class="notice-badge">
                <el-button text circle><el-icon><Bell /></el-icon></el-button>
              </el-badge>
            </template>
            <div class="notice-panel">
              <div class="notice-title">站内通知</div>
              <el-scrollbar max-height="320px">
                <div v-for="n in notices" :key="n.id" class="notice-item" :class="{ unread: !n.read_flag }" @click="readNotice(n)">
                  <div class="notice-item-head">
                    <el-tag size="small" :type="n.level === '紧急' ? 'danger' : n.level === '警告' ? 'warning' : 'info'">{{ n.level }}</el-tag>
                    <span class="notice-item-time">{{ fmtRelative(n.created_at) }}</span>
                  </div>
                  <div class="notice-item-title">{{ n.title }}</div>
                  <div class="notice-item-content">{{ n.content }}</div>
                </div>
                <el-empty v-if="!notices.length" description="暂无通知" :image-size="60" />
              </el-scrollbar>
            </div>
          </el-popover>

          <el-dropdown trigger="click" @command="onCommand">
            <div class="user-box">
              <div class="avatar" :style="{ background: auth.user?.avatarColor ?? '#1f6feb' }">{{ auth.displayName.slice(0, 1) }}</div>
              <div class="user-meta">
                <strong>{{ auth.displayName }}</strong>
                <span>{{ auth.roleText }}</span>
              </div>
              <el-icon><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">账号信息</el-dropdown-item>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="app-main">
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <el-dialog v-model="passwordVisible" title="修改登录密码" width="460px">
      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="92px">
        <el-form-item label="原密码" prop="oldPassword"><el-input v-model="pwdForm.oldPassword" type="password" show-password /></el-form-item>
        <el-form-item label="新密码" prop="newPassword"><el-input v-model="pwdForm.newPassword" type="password" show-password /></el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword"><el-input v-model="pwdForm.confirmPassword" type="password" show-password /></el-form-item>
      </el-form>
      <div class="pwd-tip">密码长度不少于 10 位，且需包含大写字母、小写字母、数字与特殊字符。</div>
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdSaving" @click="submitPassword">确定修改</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { http } from '@/api/client';
import { useAuthStore, type MenuNode } from '@/stores/auth';
import { fmtRelative } from '@/utils/format';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const collapsed = ref(false);
const notices = ref<Array<{ id: number; title: string; content: string; level: string; read_flag: number; created_at: string }>>([]);
const unreadCount = computed(() => auth.unreadCount);
const clock = ref('');
let timer: number | undefined;

const navMenus = computed<MenuNode[]>(() => auth.menus ?? []);
const activePath = computed(() => route.path);
const parentTitle = computed(() => {
  for (const m of navMenus.value) {
    if (m.children?.some((c) => c.path === route.path)) return m.name;
  }
  return '';
});

function iconOf(name: string | null): string {
  return name || 'Menu';
}

function tick(): void {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  clock.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function loadNotices(): Promise<void> {
  try {
    const res = await http.get<{ list: typeof notices.value; unread: number }>('/auth/notifications');
    notices.value = res.data.list;
    auth.unreadCount = res.data.unread;
  } catch {
    /* 通知失败不阻塞 */
  }
}

async function readNotice(n: { id: number; read_flag: number }): Promise<void> {
  if (n.read_flag) return;
  try {
    await http.put(`/auth/notifications/${n.id}/read`);
    n.read_flag = 1;
    auth.unreadCount = Math.max(0, auth.unreadCount - 1);
  } catch {
    /* 忽略 */
  }
}

const passwordVisible = ref(false);
const pwdSaving = ref(false);
const pwdFormRef = ref<FormInstance>();
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });
const pwdRules: FormRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 10, message: '密码长度不少于 10 位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_r, value, cb) => {
        if (value !== pwdForm.newPassword) cb(new Error('两次输入的密码不一致'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
};

async function submitPassword(): Promise<void> {
  if (!pwdFormRef.value) return;
  await pwdFormRef.value.validate(async (valid) => {
    if (!valid) return;
    pwdSaving.value = true;
    try {
      await http.put('/auth/password', { oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword });
      ElMessage.success('密码修改成功，请重新登录');
      passwordVisible.value = false;
      await auth.logout();
      router.push('/login');
    } finally {
      pwdSaving.value = false;
    }
  });
}

async function onCommand(command: string): Promise<void> {
  if (command === 'logout') {
    try {
      await ElMessageBox.confirm('确认退出当前登录账号？', '退出登录', { type: 'warning' });
    } catch {
      return;
    }
    await auth.logout();
    router.push('/login');
  } else if (command === 'password') {
    Object.assign(pwdForm, { oldPassword: '', newPassword: '', confirmPassword: '' });
    passwordVisible.value = true;
  } else if (command === 'profile') {
    ElMessage.info(`${auth.displayName}（${auth.user?.username}） · ${auth.user?.deptName ?? '未分配部门'} · ${auth.roleText}`);
  }
}

onMounted(async () => {
  tick();
  timer = window.setInterval(tick, 1000);
  if (!auth.menus.length) {
    try {
      await auth.fetchProfile();
    } catch {
      /* 拦截器已处理 */
    }
  }
  loadNotices();
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<style scoped>
.app-shell { height: 100vh; }
.app-aside { background: #0f1b2d; transition: width 0.2s ease; display: flex; flex-direction: column; }
.brand { height: 60px; display: flex; align-items: center; gap: 10px; padding: 0 16px; color: #fff; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.brand-logo { width: 34px; height: 34px; border-radius: 9px; background: linear-gradient(135deg, #2f81f7, #1b4fa8); display: grid; place-items: center; font-weight: 700; font-size: 17px; }
.brand-text { display: flex; flex-direction: column; line-height: 1.25; }
.brand-text strong { font-size: 14px; letter-spacing: 0.5px; }
.brand-text span { font-size: 11px; color: #8fa2bd; }
.menu-scroll { flex: 1; }
/* 去掉 Element Plus el-menu 默认的 1px 右边框，避免深色侧栏右侧出现一条浅色分隔线 */
.app-aside :deep(.el-menu) { border-right: none; }
.app-body { background: #f4f6fa; }
.app-header { height: 60px; background: #fff; border-bottom: 1px solid #e8ecf3; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.collapse-btn { color: #4b5b70; }
.header-right { display: flex; align-items: center; gap: 16px; }
.header-time { font-size: 13px; color: #7c8ba1; font-variant-numeric: tabular-nums; }
.notice-badge { cursor: pointer; }
.user-box { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 4px 6px; border-radius: 8px; }
.user-box:hover { background: #f3f6fb; }
.avatar { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 14px; }
.user-meta { display: flex; flex-direction: column; line-height: 1.25; }
.user-meta strong { font-size: 13px; color: #1f2a3a; }
.user-meta span { font-size: 11px; color: #8b98ab; }
.app-main { padding: 18px; overflow-y: auto; }
.notice-panel { padding: 4px 2px; }
.notice-title { font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #1f2a3a; }
.notice-item { padding: 8px 6px; border-radius: 8px; cursor: pointer; }
.notice-item:hover { background: #f5f8fd; }
.notice-item-head { display: flex; align-items: center; justify-content: space-between; }
.notice-item-time { font-size: 11px; color: #94a3b8; }
.notice-item-title { font-size: 13px; font-weight: 600; color: #23324a; margin-top: 4px; }
.notice-item-content { font-size: 12px; color: #64748b; margin-top: 2px; }
.notice-item.unread .notice-item-title { color: #1f6feb; }
.pwd-tip { font-size: 12px; color: #8b98ab; line-height: 1.6; padding-left: 8px; }
.fade-slide-enter-active, .fade-slide-leave-active { transition: all 0.18s ease; }
.fade-slide-enter-from { opacity: 0; transform: translateY(6px); }
.fade-slide-leave-to { opacity: 0; }
</style>
