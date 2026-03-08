CREATE TYPE "public"."org_plan" AS ENUM('free', 'pro', 'team', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('cloud', 'local');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"token" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"plan" "org_plan" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"template" varchar(100),
	"config" jsonb,
	"agent_definitions" jsonb,
	"execution_mode" "execution_mode" DEFAULT 'cloud' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_journals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_role" varchar(100) NOT NULL,
	"session_id" varchar(255),
	"entry_type" varchar(50),
	"title" text,
	"content" text,
	"tags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_status" (
	"agent_role" varchar(100) PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'stopped',
	"last_activity" timestamp with time zone,
	"current_task" text
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" varchar(255),
	"directive" text,
	"status" varchar(50),
	"pid" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"result_summary" text,
	"error_message" text,
	"total_cost_usd" double precision,
	"num_turns" integer,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "background_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"job_id" integer,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"message_type" varchar(100),
	"agent_role" varchar(100),
	"content" text
);
--> statement-breakpoint
CREATE TABLE "ceo_journal" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" varchar(255),
	"directive" text,
	"summary" text,
	"deliverables" jsonb,
	"total_cost_usd" double precision,
	"num_turns" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_role" varchar(100),
	"session_id" varchar(255),
	"input_tokens" integer DEFAULT 0,
	"output_tokens" integer DEFAULT 0,
	"estimated_cost_usd" double precision DEFAULT 0,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"title" text,
	"decided_by" varchar(100),
	"department" varchar(100),
	"options_considered" jsonb,
	"reasoning" text,
	"outcome" text,
	"status" varchar(50) DEFAULT 'active',
	"session_id" varchar(255),
	"related_task_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_onboarding" (
	"agent_role" varchar(100) PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"current_phase" integer DEFAULT 1,
	"phase_started_at" timestamp with time zone,
	"mentor" varchar(100),
	"ramp_speed" varchar(50),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_reviews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_role" varchar(100) NOT NULL,
	"reviewer" varchar(100),
	"review_type" varchar(50),
	"task_score" integer,
	"quality_score" integer,
	"efficiency_score" integer,
	"collaboration_score" integer,
	"overall_score" integer,
	"summary" text,
	"recommendation" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_data" (
	"session_id" varchar(255) PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"sdk_session_id" varchar(255),
	"project_dir" text,
	"company_name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" varchar(50) DEFAULT 'active'
);
--> statement-breakpoint
CREATE TABLE "task_blockers" (
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"task_id" integer NOT NULL,
	"blocker_id" integer NOT NULL,
	CONSTRAINT "task_blockers_task_id_blocker_id_pk" PRIMARY KEY("task_id","blocker_id")
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"task_id" integer NOT NULL,
	"author" varchar(100),
	"content" text,
	"comment_type" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" varchar(50) DEFAULT 'backlog' NOT NULL,
	"priority" varchar(50) DEFAULT 'medium' NOT NULL,
	"assignee" varchar(100),
	"reviewer" varchar(100),
	"department" varchar(100),
	"project" varchar(255),
	"parent_id" integer,
	"deadline" timestamp with time zone,
	"created_by" varchar(100),
	"session_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"output_summary" text
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_journals" ADD CONSTRAINT "agent_journals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_journals" ADD CONSTRAINT "agent_journals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status" ADD CONSTRAINT "agent_status_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status" ADD CONSTRAINT "agent_status_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_logs" ADD CONSTRAINT "background_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_logs" ADD CONSTRAINT "background_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceo_journal" ADD CONSTRAINT "ceo_journal_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceo_journal" ADD CONSTRAINT "ceo_journal_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_onboarding" ADD CONSTRAINT "hr_onboarding_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_onboarding" ADD CONSTRAINT "hr_onboarding_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_reviews" ADD CONSTRAINT "hr_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_reviews" ADD CONSTRAINT "hr_reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_data" ADD CONSTRAINT "session_data_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_data" ADD CONSTRAINT "session_data_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_blockers" ADD CONSTRAINT "task_blockers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_blockers" ADD CONSTRAINT "task_blockers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_memberships_user_org_idx" ON "org_memberships" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");