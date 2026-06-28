export interface Account {
  email: string;
  password: string;
  cardNumber: string;
  cardMonth: string;
  cardYear: string;
  cvv: string;
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** Same flags as YodoTool handle.jsc */
export interface WorkflowFlags {
  USE_OLD_CARD: boolean;
  HAVE_SAVE_CARD: boolean;
  NOT_ONLY_USE_PROXY_CONFIRM: boolean;
  IS_RUN_SLOW: boolean;
  TIME_CHECK_PRODUCT_AVAILABLE: boolean;
  TIME_WAIT: number;
}

export interface AppSettings {
  maxTab: number;
  allowPaymentShop: boolean;
  version: string;
}

export interface TaskConfig {
  productId: string;
  productLink?: string;
  accounts: Account[];
  proxy?: ProxyConfig;
  /** HH:MM:SS or "rn" for immediate */
  scheduleTime: string;
  /** Login this many minutes before schedule (nudTimeLoginBefore) */
  loginBeforeMinutes: number;
  amount: number;
  maxParallel: number;
  /** tbInfoDiscord — Discord webhook URL */
  discordWebhookUrl?: string;
  /** tbFingerPrint */
  fingerprint?: string;
  /** rbTypeSaveCard vs rbTypeNoSaveCard */
  saveCard: boolean;
  flags: WorkflowFlags;
  settings: AppSettings;
}

/** Compatible with YodoTool tmpData.json */
export interface LegacyTmpData {
  String_0: string;
  List_0: string[];
  String_1?: string;
  String_2?: string;
  Nullable_0?: number;
}

export type TaskStatus =
  | 'pending'
  | 'pre-login'
  | 'waiting'
  | 'running'
  | 'buying'
  | 'success'
  | 'failed'
  | 'stopped';

export interface TaskState {
  id: string;
  account: Account;
  proxy?: ProxyConfig;
  productId: string;
  amount: number;
  scheduleTime: string;
  status: TaskStatus;
  currentStep?: string;
  message?: string;
  startedAt?: number;
  loginAt?: number;
  buyAt?: number;
  finishedAt?: number;
  success?: boolean;
  /** ms timings for speed report */
  loginMs?: number;
  buyMs?: number;
  totalMs?: number;
}

export interface WorkflowContext {
  taskId: string;
  account: Account;
  productId: string;
  amount: number;
  flags: WorkflowFlags;
  saveCard: boolean;
  fingerprint?: string;
  nodeStateKey?: string;
  accessToken?: string;
  memberId?: string;
  ordertrace?: string;
  paymentDetails?: Record<string, string>;
  loggedIn: boolean;
}

export interface StepResult {
  ok: boolean;
  nextUrl?: string;
  error?: string;
  data?: Record<string, string>;
}

export type LogLevel = 'info' | 'step' | 'success' | 'error';

export interface LogEvent {
  taskId: string;
  email: string;
  level: LogLevel;
  message: string;
  step?: string;
  ts: number;
}

export interface RunSummary {
  total: number;
  success: number;
  failed: number;
  successAccounts: string[];
  failAccounts: string[];
  startedAt: number;
  finishedAt: number;
  productId: string;
  scheduleTime: string;
}
