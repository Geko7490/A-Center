import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  integer,
  timestamp,
  jsonb,
  real,
} from "drizzle-orm/pg-core";

export const models = pgTable("vex_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  repo: text("repo").notNull().default(""),
  version: text("version").notNull().default("latest"),
  format: text("format").notNull().default("GGUF"),
  quantization: text("quantization").notNull().default("Q4_K_M"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  installPath: text("install_path").notNull().default(""),
  runtimes: jsonb("runtimes").$type<string[]>().notNull().default([]),
  activeRuntime: text("active_runtime").notNull().default(""),
  compatibilityStatus: text("compatibility_status").notNull().default("unknown"),
  lastUsedAt: timestamp("last_used_at"),
  status: text("status").notNull().default("stopped"),
  testStatus: text("test_status").notNull().default("untested"),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("chat"),
  downloadUrl: text("download_url").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const runtimes = pgTable("vex_runtimes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  version: text("version").notNull().default(""),
  installed: boolean("installed").notNull().default(false),
  installPath: text("install_path").notNull().default(""),
  status: text("status").notNull().default("stopped"),
  logs: text("logs").notNull().default(""),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const downloads = pgTable("vex_downloads", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelName: text("model_name").notNull(),
  repo: text("repo").notNull().default(""),
  url: text("url").notNull(),
  destPath: text("dest_path").notNull().default(""),
  quantization: text("quantization").notNull().default("Q4_K_M"),
  status: text("status").notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  bytesDownloaded: bigint("bytes_downloaded", { mode: "number" }).notNull().default(0),
  totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
  speedBps: bigint("speed_bps", { mode: "number" }).notNull().default(0),
  error: text("error").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projects = pgTable("vex_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  permissionMode: text("permission_mode").notNull().default("approval"),
  protectedFiles: jsonb("protected_files").$type<string[]>().notNull().default([]),
  excludedDirs: jsonb("excluded_dirs").$type<string[]>().notNull().default(["node_modules", ".git", "dist", "build", ".next"]),
  fileSizeLimitKb: integer("file_size_limit_kb").notNull().default(1024),
  terminalAllowed: boolean("terminal_allowed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastScannedAt: timestamp("last_scanned_at"),
});

export const fileHistory = pgTable("vex_file_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  filePath: text("file_path").notNull(),
  action: text("action").notNull().default("modify"),
  diff: text("diff").notNull().default(""),
  backupPath: text("backup_path").notNull().default(""),
  previousContent: text("previous_content").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pendingChanges = pgTable("vex_pending_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  filePath: text("file_path").notNull(),
  action: text("action").notNull().default("modify"),
  newContent: text("new_content").notNull().default(""),
  diff: text("diff").notNull().default(""),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("vex_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("New conversation"),
  mode: text("mode").notNull().default("chat"),
  modelId: text("model_id").notNull().default(""),
  planningModel: text("planning_model").notNull().default(""),
  codingModel: text("coding_model").notNull().default(""),
  utilityModel: text("utility_model").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  temperature: real("temperature").notNull().default(0.7),
  contextTokens: integer("context_tokens").notNull().default(4096),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messages = pgTable("vex_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  tokens: integer("tokens").notNull().default(0),
  genMs: integer("gen_ms").notNull().default(0),
  tokensPerSec: real("tokens_per_sec").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tasks = pgTable("vex_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("general"),
  status: text("status").notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  assignedModel: text("assigned_model").notNull().default(""),
  projectId: text("project_id").notNull().default(""),
  steps: jsonb("steps").$type<{ title: string; status: string; log: string }[]>().notNull().default([]),
  currentStep: integer("current_step").notNull().default(0),
  logs: text("logs").notNull().default(""),
  modifiedFiles: jsonb("modified_files").$type<string[]>().notNull().default([]),
  error: text("error").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const plugins = pgTable("vex_plugins", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  version: text("version").notNull().default("1.0.0"),
  latestVersion: text("latest_version").notNull().default("1.0.0"),
  installed: boolean("installed").notNull().default(false),
  enabled: boolean("enabled").notNull().default(false),
  status: text("status").notNull().default("available"),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  changelog: text("changelog").notNull().default(""),
  health: text("health").notNull().default("unknown"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const gitRepos = pgTable("vex_git_repos", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  localPath: text("local_path").notNull(),
  branch: text("branch").notNull().default("main"),
  permission: text("permission").notNull().default("read-write"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const testResults = pgTable("vex_test_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelId: uuid("model_id").notNull(),
  status: text("status").notNull().default("pending"),
  latencyMs: integer("latency_ms").notNull().default(0),
  tokensPerSec: real("tokens_per_sec").notNull().default(0),
  output: text("output").notNull().default(""),
  error: text("error").notNull().default(""),
  runtime: text("runtime").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const robloxBridges = pgTable("vex_roblox", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().default(""),
  status: text("status").notNull().default("disconnected"),
  pluginVersion: text("plugin_version").notNull().default("1.0.0"),
  bridgeVersion: text("bridge_version").notNull().default("1.0.0"),
  logs: text("logs").notNull().default(""),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const terminalHistory = pgTable("vex_terminal_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  command: text("command").notNull(),
  output: text("output").notNull().default(""),
  exitCode: integer("exit_code").notNull().default(0),
  cwd: text("cwd").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const appSettings = pgTable("vex_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
