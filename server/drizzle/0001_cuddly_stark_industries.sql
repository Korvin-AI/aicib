CREATE TABLE "auto_review_queue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_role" varchar(100),
	"trigger_event" varchar(100),
	"trigger_data" jsonb,
	"status" varchar(50) DEFAULT 'pending',
	"review_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"event_type" varchar(100),
	"schedule_id" integer,
	"cron_expression" varchar(100),
	"discussion_format" varchar(100),
	"participants_config" jsonb,
	"enabled" boolean DEFAULT true,
	"run_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" varchar(255),
	"from_agent" varchar(100),
	"to_agent" varchar(100),
	"step" integer,
	"priority" varchar(50),
	"category" varchar(100),
	"reason" text,
	"resolved" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_instances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"status" varchar(50),
	"participants" jsonb,
	"agenda" text,
	"minutes" text,
	"action_items" jsonb,
	"summary" text,
	"duration_ms" integer,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_role" varchar(100),
	"category" varchar(100),
	"description" text,
	"outcome" text,
	"approved_by" varchar(100),
	"rejected_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_role" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"details" jsonb,
	"performed_by" varchar(100),
	"session_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_improvement_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_role" varchar(100) NOT NULL,
	"created_by" varchar(100),
	"goals" jsonb,
	"deadline" timestamp with time zone,
	"status" varchar(50) DEFAULT 'active',
	"outcome" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_integrations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"server_name" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'inactive',
	"last_used" timestamp with time zone,
	"use_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"scope" varchar(50) NOT NULL,
	"scope_value" varchar(255),
	"min_push_urgency" varchar(50),
	"digest_frequency" varchar(50),
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"title" varchar(500),
	"body" text,
	"urgency" varchar(50),
	"category" varchar(100),
	"source_agent" varchar(100),
	"target_agent" varchar(100),
	"status" varchar(50) DEFAULT 'unread',
	"delivery_channel" varchar(50),
	"metadata" jsonb,
	"scheduled_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_phases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"project_id" integer NOT NULL,
	"phase_number" integer NOT NULL,
	"title" varchar(500),
	"objective" text,
	"acceptance_criteria" text,
	"status" varchar(50) DEFAULT 'pending',
	"sdk_session_id" varchar(255),
	"attempt" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 3,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" varchar(255),
	"title" varchar(500) NOT NULL,
	"original_brief" text,
	"status" varchar(50) DEFAULT 'planning',
	"total_phases" integer,
	"completed_phases" integer DEFAULT 0,
	"total_cost_usd" double precision DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"report_type" varchar(100),
	"title" varchar(500),
	"author_agent" varchar(100),
	"content" text,
	"metrics_snapshot" jsonb,
	"status" varchar(50) DEFAULT 'draft',
	"delivery_method" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safeguard_pending" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_role" varchar(100),
	"category" varchar(100),
	"description" text,
	"approval_chain" jsonb,
	"current_step" integer DEFAULT 0,
	"status" varchar(50) DEFAULT 'pending',
	"approvals" jsonb,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_archives" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"project_name" varchar(500) NOT NULL,
	"description" text,
	"status" varchar(50),
	"deliverables" jsonb,
	"lessons_learned" text,
	"total_cost_usd" double precision,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" varchar(100),
	"session_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_article_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"article_id" integer NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(500),
	"content" text,
	"edited_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_articles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"section" varchar(255),
	"content" text,
	"version" integer DEFAULT 1,
	"created_by" varchar(100),
	"updated_by" varchar(100),
	"session_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_executions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"schedule_id" integer NOT NULL,
	"job_id" integer,
	"trigger_source" varchar(100),
	"status" varchar(50),
	"cost_usd" double precision,
	"num_turns" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_state" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"cron_expression" varchar(100),
	"agent_target" varchar(100),
	"directive" text,
	"enabled" boolean DEFAULT true,
	"status" varchar(50) DEFAULT 'idle',
	"trigger_type" varchar(50),
	"run_count" integer DEFAULT 0,
	"total_cost_usd" double precision DEFAULT 0,
	"max_retries" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_review_queue" ADD CONSTRAINT "auto_review_queue_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_review_queue" ADD CONSTRAINT "auto_review_queue_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_events" ADD CONSTRAINT "company_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_events" ADD CONSTRAINT "company_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances" ADD CONSTRAINT "event_instances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_instances" ADD CONSTRAINT "event_instances_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actions" ADD CONSTRAINT "external_actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actions" ADD CONSTRAINT "external_actions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_improvement_plans" ADD CONSTRAINT "hr_improvement_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_improvement_plans" ADD CONSTRAINT "hr_improvement_plans_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_integrations" ADD CONSTRAINT "mcp_integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_integrations" ADD CONSTRAINT "mcp_integrations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguard_pending" ADD CONSTRAINT "safeguard_pending_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguard_pending" ADD CONSTRAINT "safeguard_pending_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_archives" ADD CONSTRAINT "project_archives_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_archives" ADD CONSTRAINT "project_archives_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_article_versions" ADD CONSTRAINT "wiki_article_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_article_versions" ADD CONSTRAINT "wiki_article_versions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_articles" ADD CONSTRAINT "wiki_articles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_articles" ADD CONSTRAINT "wiki_articles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_executions" ADD CONSTRAINT "schedule_executions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_executions" ADD CONSTRAINT "schedule_executions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_state" ADD CONSTRAINT "scheduler_state_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_state" ADD CONSTRAINT "scheduler_state_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_integrations_business_server_idx" ON "mcp_integrations" USING btree ("business_id","server_name");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_prefs_business_scope_idx" ON "notification_preferences" USING btree ("business_id","scope","scope_value");--> statement-breakpoint
CREATE UNIQUE INDEX "project_phases_project_phase_idx" ON "project_phases" USING btree ("project_id","phase_number");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_versions_article_version_idx" ON "wiki_article_versions" USING btree ("article_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_articles_business_slug_idx" ON "wiki_articles" USING btree ("business_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_state_business_key_idx" ON "scheduler_state" USING btree ("business_id","key");