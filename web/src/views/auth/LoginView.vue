<template>
  <div class="login-page">
    <section class="login-hero">
      <div class="hero-brand">
        <span class="hero-badge">DSG</span>
        <span>大数据安全治理与服务保障平台</span>
      </div>
      <h1>覆盖数据全生命周期的<br />安全治理与风险监测一体化平台</h1>
      <p>
        面向数据资产盘点、分类分级、合规检查、风险监测、权限管控、审计追溯与运维保障，
        构建「事前预防、事中监控、事后追溯」的数据安全治理闭环。
      </p>
      <div class="hero-tags">
        <span>数据安全法</span>
        <span>个人信息保护法</span>
        <span>等保 2.0</span>
        <span>六大安全模块</span>
        <span>四级 RBAC</span>
      </div>
      <div class="hero-metrics">
        <div><b>64</b><span>纳管数据资产</span></div>
        <div><b>8</b><span>来源业务系统</span></div>
        <div><b>10</b><span>风险监测规则</span></div>
      </div>
    </section>

    <section class="login-panel">
      <div class="login-card">
        <h2>账号登录</h2>
        <div class="login-sub">请使用平台分配的账号登录，敏感操作将全程留痕审计</div>
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="submit">
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" size="large" placeholder="请输入用户名" prefix-icon="User" autocomplete="username" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" size="large" type="password" show-password placeholder="请输入登录密码" prefix-icon="Lock" autocomplete="current-password" />
          </el-form-item>
          <el-button type="primary" size="large" class="w-full" :loading="loading" @click="submit">登 录</el-button>
        </el-form>

        <div class="login-accounts">
          <div v-for="acc in demoAccounts" :key="acc.username" class="login-account" @click="fill(acc)">
            <b>{{ acc.label }}</b>{{ acc.username }} / {{ acc.password }}
          </div>
        </div>
        <div class="login-footer">
          大数据安全治理与服务保障平台 V1.0.0<br />
          连续 5 次登录失败将锁定账号 30 分钟
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ username: 'admin', password: 'Admin@2026' });

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入登录密码', trigger: 'blur' }],
};

const demoAccounts = [
  { label: '超级管理员', username: 'admin', password: 'Admin@2026' },
  { label: '安全管理员', username: 'secadmin', password: 'Sec@2026' },
  { label: '合规专员', username: 'compliance', password: 'Comp@2026' },
  { label: '数据管理员', username: 'steward', password: 'Steward@2026' },
  { label: '审计员', username: 'auditor', password: 'Audit@2026' },
  { label: '运维工程师', username: 'ops', password: 'Ops@2026' },
];

function fill(acc: { username: string; password: string }): void {
  form.username = acc.username;
  form.password = acc.password;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    loading.value = true;
    try {
      await auth.login(form.username, form.password);
      ElMessage.success(`欢迎回来，${auth.displayName}`);
      const redirect = (route.query.redirect as string | undefined) ?? '/dashboard';
      router.replace(redirect);
    } finally {
      loading.value = false;
    }
  });
}
</script>

<style scoped>
.hero-brand { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #b9d1f7; letter-spacing: 1px; margin-bottom: 46px; }
.hero-badge { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; font-size: 13px; background: linear-gradient(135deg, #2f81f7, #1b4fa8); color: #fff; }
</style>
