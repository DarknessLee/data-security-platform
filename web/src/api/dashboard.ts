import { http } from '@/api/client';

export interface DashboardCards {
  totalAssets: number;
  sensitiveAssets: number;
  openRisk: number;
  urgentRisk: number;
  pendingTickets: number;
  openRectify: number;
  todayLogs: number;
  onlineUsers: number;
  complianceRate: number;
  latestBatchNo: string | null;
}

export interface NameValue {
  name: string;
  value: number;
}

export interface RiskEventRow {
  id: number;
  event_no: string;
  event_type: string;
  level: string;
  status: string;
  username: string;
  ip: string | null;
  occurred_at: string;
  asset_name: string | null;
}

export interface OpsSeriesItem {
  time: string;
  cpu: number;
  mem: number;
  qps: number;
}

export interface NoticeItem {
  id: number;
  title: string;
  content: string;
  level: string;
  read_flag: number;
  created_at: string;
}

export interface DashboardOverview {
  cards: DashboardCards;
  assetLevel: NameValue[];
  assetStage: NameValue[];
  riskLevel: NameValue[];
  riskTrend: Array<{ date: string; total: number; high: number }>;
  complianceTrend: Array<{ batch: string; rate: number }>;
  recentEvents: RiskEventRow[];
  ticketByStatus: NameValue[];
  opsLatest: Record<string, string | number | null> | null;
  opsSeries: OpsSeriesItem[];
  notices: NoticeItem[];
  generatedAt: string;
}

export function getOverview() {
  return http.get<DashboardOverview>('/dashboard/overview');
}
