CREATE TABLE "vex_ai_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"call_id" text NOT NULL,
	"name" text NOT NULL,
	"args" jsonb NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vex_ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"usage" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vex_ai_usage_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "vex_conversations" ADD COLUMN "provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vex_messages" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;