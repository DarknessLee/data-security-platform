// 种子数据公共能力：确定性随机、日期、姓名/机构词库
// 目标：每次重建数据基线，计数与关键指标保持一致（可断言）

/** 确定性伪随机（mulberry32），避免每次重建数据漂移 */
export function createRng(seed = 20261107) {
  let a = seed >>> 0;
  return function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickMany(rng, arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  }
  return out;
}

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${fmtDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 以初始化时刻为初始化基准时间，保证“最近 7 天”始终贴近当前时间 */
export const BASE_TIME = new Date();

export function daysAgo(n, hour = 9, minute = 0) {
  const d = new Date(BASE_TIME);
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function hoursAgo(n) {
  return new Date(BASE_TIME.getTime() - n * 3600 * 1000);
}

export function plusDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

export const SURNAMES = ['张', '王', '李', '赵', '陈', '刘', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗'];
export const GIVEN_NAMES = ['建国', '慧敏', '志强', '晓东', '雪梅', '文博', '海涛', '静怡', '俊杰', '丽娟', '国华', '雅琴', '振宇', '思远', '佳琪', '明辉', '春燕', '子涵', '浩然', '雨欣'];

export function cnName(rng) {
  return pick(rng, SURNAMES) + pick(rng, GIVEN_NAMES);
}

export const CITIES = [
  ['北京', '北京市'],
  ['上海', '上海市'],
  ['广州', '广东省广州市'],
  ['深圳', '广东省深圳市'],
  ['杭州', '浙江省杭州市'],
  ['成都', '四川省成都市'],
  ['武汉', '湖北省武汉市'],
  ['南京', '江苏省南京市'],
  ['西安', '陕西省西安市'],
  ['苏州', '江苏省苏州市'],
];

export const DEVICES = ['Chrome 131 / Windows 11', 'Edge 130 / Windows 10', 'Safari 18 / macOS 15', 'Chrome 130 / Android 15', '企业微信内置浏览器', 'Firefox 133 / Ubuntu 24.04'];

export const SYSTEM_NAMES = ['数据共享交换平台', '人口基础信息库', '企业信用信息平台', '电子证照系统', '医疗保障信息平台', '交通大数据中心', '政务服务中台', '金融风控平台', '物联网感知平台', '统一身份认证平台'];
