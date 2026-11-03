CREATE TABLE "vex_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vex_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "vex_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"mode" text DEFAULT 'chat' NOT NULL,
	"model_id" text DEFAULT '' NOT NULL,
	"planning_model" text DEFAULT '' NOT NULL,
	"coding_model" text DEFAULT '' NOT NULL,
	"utility_model" text DEFAULT '' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"temperature" real DEFAULT 0.7 NOT NULL,
	"context_tokens" integer DEFAULT 4096 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_name" text NOT NULL,
	"repo" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"dest_path" text DEFAULT '' NOT NULL,
	"quantization" text DEFAULT 'Q4_K_M' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"bytes_downloaded" bigint DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"speed_bps" bigint DEFAULT 0 NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_file_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"action" text DEFAULT 'modify' NOT NULL,
	"diff" text DEFAULT '' NOT NULL,
	"backup_path" text DEFAULT '' NOT NULL,
	"previous_content" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_git_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"local_path" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"permission" text DEFAULT 'read-write' NOT NULL,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"gen_ms" integer DEFAULT 0 NOT NULL,
	"tokens_per_sec" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"repo" text DEFAULT '' NOT NULL,
	"version" text DEFAULT 'latest' NOT NULL,
	"format" text DEFAULT 'GGUF' NOT NULL,
	"quantization" text DEFAULT 'Q4_K_M' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"install_path" text DEFAULT '' NOT NULL,
	"runtimes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_runtime" text DEFAULT '' NOT NULL,
	"compatibility_status" text DEFAULT 'unknown' NOT NULL,
	"last_used_at" timestamp,
	"status" text DEFAULT 'stopped' NOT NULL,
	"test_status" text DEFAULT 'untested' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'chat' NOT NULL,
	"download_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_pending_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"action" text DEFAULT 'modify' NOT NULL,
	"new_content" text DEFAULT '' NOT NULL,
	"diff" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"latest_version" text DEFAULT '1.0.0' NOT NULL,
	"installed" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vex_plugins_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "vex_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"permission_mode" text DEFAULT 'approval' NOT NULL,
	"protected_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_dirs" jsonb DEFAULT '["node_modules",".git","dist","build",".next"]'::jsonb NOT NULL,
	"file_size_limit_kb" integer DEFAULT 1024 NOT NULL,
	"terminal_allowed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_scanned_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "vex_roblox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"plugin_version" text DEFAULT '1.0.0' NOT NULL,
	"bridge_version" text DEFAULT '1.0.0' NOT NULL,
	"logs" text DEFAULT '' NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_runtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"installed" boolean DEFAULT false NOT NULL,
	"install_path" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'stopped' NOT NULL,
	"logs" text DEFAULT '' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vex_runtimes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "vex_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"assigned_model" text DEFAULT '' NOT NULL,
	"project_id" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"logs" text DEFAULT '' NOT NULL,
	"modified_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_terminal_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command" text NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"exit_code" integer DEFAULT 0 NOT NULL,
	"cwd" text DEFAULT '' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"tokens_per_sec" real DEFAULT 0 NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"runtime" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

