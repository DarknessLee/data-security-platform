-- 大数据安全治理与服务保障平台 · 数据库结构（v1，只向前演进）
-- 字符集 utf8mb4；所有时间字段使用 DATETIME（应用层统一 Asia/Shanghai）
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS sys_user_role;
DROP TABLE IF EXISTS sys_role_menu;
DROP TABLE IF EXISTS sys_role_api;
DROP TABLE IF EXISTS sys_api_permission;
DROP TABLE IF EXISTS sys_role;
DROP TABLE IF EXISTS sys_user;
DROP TABLE IF EXISTS sys_menu;
DROP TABLE IF EXISTS sys_dept;
DROP TABLE IF EXISTS sys_config;
DROP TABLE IF EXISTS notification;
DROP TABLE IF EXISTS asset_lifecycle;
DROP TABLE IF EXISTS asset_tag;
DROP TABLE IF EXISTS share_approval;
DROP TABLE IF EXISTS data_asset;
DROP TABLE IF EXISTS asset_category;
DROP TABLE IF EXISTS compliance_check;
DROP TABLE IF EXISTS compliance_rectify;
DROP TABLE IF EXISTS compliance_rule;
DROP TABLE IF EXISTS masking_rule;
DROP TABLE IF EXISTS risk_event;
DROP TABLE IF EXISTS risk_rule;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS audit_report;
DROP TABLE IF EXISTS service_ticket;
DROP TABLE IF EXISTS ticket_trace;
DROP TABLE IF EXISTS backup_record;
DROP TABLE IF EXISTS ops_metric;

SET FOREIGN_KEY_CHECKS = 1;

-- ============ 一、组织与权限（用户 / 角色 / 菜单 / 接口 四级权限） ============
CREATE TABLE sys_dept (
  id INT PRIMARY KEY AUTO_INCREMENT,
  dept_code VARCHAR(32) NOT NULL UNIQUE COMMENT '部门编码',
  dept_name VARCHAR(64) NOT NULL COMMENT '部门名称',
  parent_id INT NULL COMMENT '上级部门',
  leader VARCHAR(32) COMMENT '负责人',
  description VARCHAR(255) COMMENT '职责描述',
  sort INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='组织部门';

CREATE TABLE sys_user (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(32) NOT NULL UNIQUE COMMENT '登录账号',
  password_hash VARCHAR(100) NOT NULL,
  real_name VARCHAR(32) NOT NULL COMMENT '姓名',
  dept_id INT COMMENT '所属部门',
  job_title VARCHAR(64) COMMENT '岗位',
  phone VARCHAR(20),
  email VARCHAR(64),
  avatar_color VARCHAR(16) DEFAULT '#1f6feb',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1正常 0停用 2锁定',
  last_login_at DATETIME,
  last_login_ip VARCHAR(45),
  pwd_updated_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_dept FOREIGN KEY (dept_id) REFERENCES sys_dept(id),
  KEY idx_user_dept (dept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台用户';

CREATE TABLE sys_role (
  id INT PRIMARY KEY AUTO_INCREMENT,
  role_code VARCHAR(32) NOT NULL UNIQUE COMMENT '角色编码',
  role_name VARCHAR(64) NOT NULL COMMENT '角色名称',
  description VARCHAR(255),
  data_scope VARCHAR(16) NOT NULL DEFAULT 'ALL' COMMENT 'ALL全部 DEPT本部门 SELF仅本人 CUSTOM自定义',
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色';

CREATE TABLE sys_user_role (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES sys_role(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户-角色';

CREATE TABLE sys_menu (
  id INT PRIMARY KEY AUTO_INCREMENT,
  parent_id INT NOT NULL DEFAULT 0 COMMENT '0为顶级',
  menu_name VARCHAR(64) NOT NULL,
  path VARCHAR(128) COMMENT '前端路由',
  icon VARCHAR(32) COMMENT '图标名',
  permission_code VARCHAR(64) COMMENT '权限标识，如 asset:read',
  menu_type VARCHAR(16) NOT NULL DEFAULT '菜单' COMMENT '目录/菜单/按钮',
  sort INT NOT NULL DEFAULT 0,
  visible TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='菜单与权限点';

CREATE TABLE sys_role_menu (
  role_id INT NOT NULL,
  menu_id INT NOT NULL,
  perm_read TINYINT NOT NULL DEFAULT 1,
  perm_write TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, menu_id),
  CONSTRAINT fk_rm_role FOREIGN KEY (role_id) REFERENCES sys_role(id) ON DELETE CASCADE,
  CONSTRAINT fk_rm_menu FOREIGN KEY (menu_id) REFERENCES sys_menu(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-菜单';

CREATE TABLE sys_api_permission (
  id INT PRIMARY KEY AUTO_INCREMENT,
  api_code VARCHAR(48) NOT NULL UNIQUE COMMENT '接口权限编码，如 asset:list',
  api_name VARCHAR(64) NOT NULL,
  api_group VARCHAR(32) NOT NULL COMMENT '所属模块',
  method VARCHAR(8) NOT NULL,
  path VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='接口权限清单';

CREATE TABLE sys_role_api (
  role_id INT NOT NULL,
  api_permission_id INT NOT NULL,
  PRIMARY KEY (role_id, api_permission_id),
  CONSTRAINT fk_ra_role FOREIGN KEY (role_id) REFERENCES sys_role(id) ON DELETE CASCADE,
  CONSTRAINT fk_ra_api FOREIGN KEY (api_permission_id) REFERENCES sys_api_permission(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-接口权限';

CREATE TABLE sys_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  config_key VARCHAR(64) NOT NULL UNIQUE,
  config_value VARCHAR(512) NOT NULL,
  config_group VARCHAR(32) NOT NULL DEFAULT '通用',
  description VARCHAR(255),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台参数配置';

CREATE TABLE notification (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT COMMENT 'NULL 表示全员公告',
  title VARCHAR(128) NOT NULL,
  content VARCHAR(512) NOT NULL,
  level VARCHAR(8) NOT NULL DEFAULT '信息' COMMENT '信息/警告/紧急',
  read_flag TINYINT NOT NULL DEFAULT 0,
  biz_type VARCHAR(32) COMMENT 'risk/compliance/ticket/backup',
  biz_id INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_noti_user (user_id, read_flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内通知';

-- ============ 二、数据资产治理 ============
CREATE TABLE asset_category (
  id INT PRIMARY KEY AUTO_INCREMENT,
  category_code VARCHAR(32) NOT NULL UNIQUE,
  category_name VARCHAR(64) NOT NULL,
  parent_id INT NOT NULL DEFAULT 0,
  description VARCHAR(255),
  sort INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据资产分类';

CREATE TABLE data_asset (
  id INT PRIMARY KEY AUTO_INCREMENT,
  asset_code VARCHAR(32) NOT NULL UNIQUE COMMENT '资产编号，如 DA-2026-0001',
  asset_name VARCHAR(128) NOT NULL,
  category_id INT NOT NULL,
  dept_id INT NOT NULL COMMENT '责任部门',
  source_system VARCHAR(64) NOT NULL COMMENT '来源系统',
  data_type VARCHAR(16) NOT NULL COMMENT '结构化/半结构化/非结构化',
  data_level VARCHAR(8) NOT NULL COMMENT '公开/内部/机密/绝密',
  file_format VARCHAR(32) COMMENT '存储格式',
  size_gb DECIMAL(12,2) NOT NULL DEFAULT 0,
  row_count BIGINT NOT NULL DEFAULT 0,
  owner VARCHAR(32) NOT NULL COMMENT '数据责任人',
  status VARCHAR(16) NOT NULL DEFAULT '正常' COMMENT '正常/待治理/风险/已归档',
  lifecycle_stage VARCHAR(16) NOT NULL DEFAULT '存储' COMMENT '采集/存储/使用/共享/销毁',
  sensitivity_score INT NOT NULL DEFAULT 50 COMMENT '敏感度 0-100',
  quality_score INT NOT NULL DEFAULT 90 COMMENT '质量分 0-100',
  description VARCHAR(512),
  discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发现时间',
  last_access_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_asset_cat FOREIGN KEY (category_id) REFERENCES asset_category(id),
  CONSTRAINT fk_asset_dept FOREIGN KEY (dept_id) REFERENCES sys_dept(id),
  KEY idx_asset_level (data_level),
  KEY idx_asset_dept (dept_id),
  KEY idx_asset_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据资产台账';

CREATE TABLE asset_tag (
  id INT PRIMARY KEY AUTO_INCREMENT,
  asset_id INT NOT NULL,
  tag_name VARCHAR(32) NOT NULL,
  CONSTRAINT fk_tag_asset FOREIGN KEY (asset_id) REFERENCES data_asset(id) ON DELETE CASCADE,
  KEY idx_tag_asset (asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资产标签';

CREATE TABLE asset_lifecycle (
  id INT PRIMARY KEY AUTO_INCREMENT,
  asset_id INT NOT NULL,
  stage VARCHAR(16) NOT NULL COMMENT '采集/存储/使用/共享/销毁',
  action VARCHAR(64) NOT NULL,
  operator VARCHAR(32) NOT NULL,
  detail VARCHAR(512),
  occurred_at DATETIME NOT NULL,
  CONSTRAINT fk_life_asset FOREIGN KEY (asset_id) REFERENCES data_asset(id) ON DELETE CASCADE,
  KEY idx_life_asset (asset_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资产生命周期记录';

-- ============ 三、安全合规管理 ============
CREATE TABLE compliance_rule (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rule_code VARCHAR(32) NOT NULL UNIQUE COMMENT '规则编号，如 CR-DSL-001',
  rule_title VARCHAR(128) NOT NULL,
  basis VARCHAR(32) NOT NULL COMMENT '数据安全法/个人信息保护法/等保2.0/行业规范',
  category VARCHAR(32) NOT NULL COMMENT '分类分级/访问控制/加密脱敏/审计留痕/跨境传输',
  requirement VARCHAR(512) NOT NULL COMMENT '合规要求原文/摘要',
  risk_level VARCHAR(8) NOT NULL DEFAULT '中',
  check_method VARCHAR(8) NOT NULL DEFAULT '自动' COMMENT '自动/人工',
  status VARCHAR(8) NOT NULL DEFAULT '启用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合规检查规则库';

CREATE TABLE compliance_check (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rule_id INT NOT NULL,
  batch_no VARCHAR(32) NOT NULL COMMENT '检查批次',
  target VARCHAR(128) NOT NULL COMMENT '检查对象',
  result VARCHAR(8) NOT NULL COMMENT '通过/警告/不通过',
  score INT NOT NULL DEFAULT 100,
  evidence VARCHAR(512) COMMENT '检查证据',
  duration_ms INT NOT NULL DEFAULT 0,
  checked_at DATETIME NOT NULL,
  CONSTRAINT fk_check_rule FOREIGN KEY (rule_id) REFERENCES compliance_rule(id),
  KEY idx_check_batch (batch_no),
  KEY idx_check_result (result)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合规检查结果';

CREATE TABLE compliance_rectify (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rectify_no VARCHAR(32) NOT NULL UNIQUE COMMENT '整改单号',
  check_id INT NOT NULL,
  title VARCHAR(128) NOT NULL,
  owner VARCHAR(32) NOT NULL COMMENT '整改责任人',
  dept_id INT NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT '待整改' COMMENT '待整改/整改中/已闭环/已逾期',
  progress INT NOT NULL DEFAULT 0 COMMENT '进度 0-100',
  measure VARCHAR(512) COMMENT '整改措施',
  closed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rect_check FOREIGN KEY (check_id) REFERENCES compliance_check(id),
  CONSTRAINT fk_rect_dept FOREIGN KEY (dept_id) REFERENCES sys_dept(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合规整改单';

CREATE TABLE masking_rule (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rule_name VARCHAR(64) NOT NULL,
  field_pattern VARCHAR(128) NOT NULL COMMENT '字段匹配模式',
  algorithm VARCHAR(16) NOT NULL COMMENT '掩码/哈希/加密/泛化',
  mask_type VARCHAR(8) NOT NULL COMMENT '静态/动态',
  scene VARCHAR(64) NOT NULL COMMENT '适用场景',
  status VARCHAR(8) NOT NULL DEFAULT '启用',
  sample_before VARCHAR(64) NOT NULL COMMENT '脱敏前样例',
  sample_after VARCHAR(64) NOT NULL COMMENT '脱敏后样例',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据脱敏规则';

CREATE TABLE share_approval (
  id INT PRIMARY KEY AUTO_INCREMENT,
  approval_no VARCHAR(32) NOT NULL UNIQUE COMMENT '审批单号',
  asset_id INT NOT NULL,
  applicant_id INT NOT NULL,
  applicant_name VARCHAR(32) NOT NULL,
  receiver VARCHAR(64) NOT NULL COMMENT '数据接收方',
  purpose VARCHAR(255) NOT NULL COMMENT '共享用途',
  share_way VARCHAR(32) NOT NULL COMMENT '接口/文件/数据库直连',
  risk_level VARCHAR(8) NOT NULL DEFAULT '中',
  status VARCHAR(16) NOT NULL DEFAULT '待审批' COMMENT '待审批/已通过/已驳回/已撤回',
  approver VARCHAR(32),
  approved_at DATETIME,
  comment VARCHAR(255) COMMENT '审批意见',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_share_asset FOREIGN KEY (asset_id) REFERENCES data_asset(id),
  KEY idx_share_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据共享合规审批';

-- ============ 四、智能风险监测 ============
CREATE TABLE risk_rule (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rule_code VARCHAR(32) NOT NULL UNIQUE,
  rule_name VARCHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL COMMENT '越权访问/批量导出/异常登录/数据篡改/敏感外传',
  expression VARCHAR(255) NOT NULL COMMENT '检测表达式',
  level VARCHAR(8) NOT NULL DEFAULT '中',
  enabled TINYINT NOT NULL DEFAULT 1,
  hit_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='风险监测规则';

CREATE TABLE risk_event (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_no VARCHAR(32) NOT NULL UNIQUE COMMENT '事件编号，如 RE-20261107-0001',
  rule_id INT,
  event_type VARCHAR(32) NOT NULL,
  level VARCHAR(8) NOT NULL COMMENT '低/中/高/紧急',
  asset_id INT,
  username VARCHAR(32) NOT NULL COMMENT '操作人',
  dept_id INT,
  ip VARCHAR(45),
  device VARCHAR(64),
  location VARCHAR(64) COMMENT '归属地',
  detail VARCHAR(512) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT '待处置' COMMENT '待处置/处置中/已处置/已忽略',
  occurred_at DATETIME NOT NULL,
  handled_by VARCHAR(32),
  handled_at DATETIME,
  handle_note VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_risk_rule FOREIGN KEY (rule_id) REFERENCES risk_rule(id),
  CONSTRAINT fk_risk_asset FOREIGN KEY (asset_id) REFERENCES data_asset(id),
  KEY idx_risk_status (status),
  KEY idx_risk_level (level),
  KEY idx_risk_time (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='风险事件';

-- ============ 五、安全审计追溯 ============
CREATE TABLE audit_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  log_type VARCHAR(16) NOT NULL COMMENT '登录日志/访问日志/操作日志/接口日志',
  user_id INT,
  username VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL COMMENT '动作描述',
  resource VARCHAR(64) COMMENT '资源类型',
  method VARCHAR(8),
  path VARCHAR(128),
  ip VARCHAR(45),
  user_agent VARCHAR(255),
  status_code INT NOT NULL DEFAULT 200,
  result VARCHAR(8) NOT NULL DEFAULT '成功' COMMENT '成功/失败',
  detail VARCHAR(512),
  created_at DATETIME NOT NULL,
  KEY idx_log_type (log_type),
  KEY idx_log_time (created_at),
  KEY idx_log_user (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全量审计日志';

CREATE TABLE audit_report (
  id INT PRIMARY KEY AUTO_INCREMENT,
  report_no VARCHAR(32) NOT NULL UNIQUE,
  report_name VARCHAR(128) NOT NULL,
  report_type VARCHAR(8) NOT NULL COMMENT '日报/周报/月报/年报',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_events INT NOT NULL DEFAULT 0,
  risk_events INT NOT NULL DEFAULT 0,
  compliance_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  generated_by VARCHAR(32) NOT NULL,
  content VARCHAR(1024) COMMENT '报表摘要',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='安全审计报表';

-- ============ 六、服务保障运维 ============
CREATE TABLE service_ticket (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_no VARCHAR(32) NOT NULL UNIQUE COMMENT '工单号，如 TK-20261107-001',
  title VARCHAR(128) NOT NULL,
  category VARCHAR(16) NOT NULL COMMENT '故障处理/安全事件/服务咨询/变更申请',
  priority VARCHAR(8) NOT NULL DEFAULT '中' COMMENT '低/中/高/紧急',
  status VARCHAR(16) NOT NULL DEFAULT '待受理' COMMENT '待受理/处理中/待验证/已关闭',
  reporter VARCHAR(32) NOT NULL,
  assignee VARCHAR(32),
  contact VARCHAR(32),
  description VARCHAR(1024) NOT NULL,
  resolution VARCHAR(1024),
  sla_hours INT NOT NULL DEFAULT 24,
  created_at DATETIME NOT NULL,
  accepted_at DATETIME,
  closed_at DATETIME,
  KEY idx_ticket_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='安全运维工单';

CREATE TABLE ticket_trace (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  action VARCHAR(32) NOT NULL COMMENT '创建/受理/处理/验证/关闭/催办',
  operator VARCHAR(32) NOT NULL,
  note VARCHAR(512),
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_trace_ticket FOREIGN KEY (ticket_id) REFERENCES service_ticket(id) ON DELETE CASCADE,
  KEY idx_trace_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工单流转轨迹';

CREATE TABLE backup_record (
  id INT PRIMARY KEY AUTO_INCREMENT,
  backup_no VARCHAR(32) NOT NULL UNIQUE,
  backup_type VARCHAR(8) NOT NULL COMMENT '全量/增量',
  scope VARCHAR(128) NOT NULL COMMENT '备份范围',
  size_mb DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(8) NOT NULL DEFAULT '成功' COMMENT '成功/失败/进行中',
  storage_path VARCHAR(255) NOT NULL,
  checksum VARCHAR(64),
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  operator VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据备份记录';

CREATE TABLE ops_metric (
  id INT PRIMARY KEY AUTO_INCREMENT,
  metric_time DATETIME NOT NULL,
  cpu_usage DECIMAL(5,2) NOT NULL,
  mem_usage DECIMAL(5,2) NOT NULL,
  disk_usage DECIMAL(5,2) NOT NULL,
  api_qps INT NOT NULL,
  api_avg_ms INT NOT NULL,
  db_connections INT NOT NULL,
  redis_hit_rate DECIMAL(5,2) NOT NULL,
  online_users INT NOT NULL,
  UNIQUE KEY uk_metric_time (metric_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运维监控指标';
