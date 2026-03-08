-- Row-Level Security policies for multi-tenant isolation
-- Defense-in-depth: even if app-layer filtering has a bug, the DB refuses cross-org access.
-- Per-transaction: SET LOCAL app.org_id = '<uuid>' is set by RLS middleware.
-- current_setting('app.org_id', true) returns NULL if unset → fail-closed (no rows match).
--
-- FORCE ROW LEVEL SECURITY deferred until repos use request-scoped transactions.
-- ENABLE RLS is set so policies and indexes exist; they are inert for the table owner role.
-- When a dedicated app_user role is created, FORCE can be re-enabled.

-- Helper: create RLS policy + org_id index for a given table
-- We apply to all tables that have an org_id column.

-- 1. businesses
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "businesses"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_businesses_org_id ON "businesses"(org_id);

-- 2. cost_entries
ALTER TABLE "cost_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_entries"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_cost_entries_org_id ON "cost_entries"(org_id);

-- 3. sessions
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sessions"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_sessions_org_id ON "sessions"(org_id);

-- 4. agent_status
ALTER TABLE "agent_status" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_status"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_agent_status_org_id ON "agent_status"(org_id);

-- 5. session_data
ALTER TABLE "session_data" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "session_data"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_session_data_org_id ON "session_data"(org_id);

-- 6. background_jobs
ALTER TABLE "background_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "background_jobs"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_background_jobs_org_id ON "background_jobs"(org_id);

-- 7. background_logs
ALTER TABLE "background_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "background_logs"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_background_logs_org_id ON "background_logs"(org_id);

-- 8. ceo_journal
ALTER TABLE "ceo_journal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ceo_journal"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_ceo_journal_org_id ON "ceo_journal"(org_id);

-- 9. tasks
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tasks"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON "tasks"(org_id);

-- 10. task_blockers
ALTER TABLE "task_blockers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task_blockers"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_task_blockers_org_id ON "task_blockers"(org_id);

-- 11. task_comments
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task_comments"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_task_comments_org_id ON "task_comments"(org_id);

-- 12. agent_journals
ALTER TABLE "agent_journals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_journals"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_agent_journals_org_id ON "agent_journals"(org_id);

-- 13. decision_log
ALTER TABLE "decision_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "decision_log"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_decision_log_org_id ON "decision_log"(org_id);

-- 14. hr_onboarding
ALTER TABLE "hr_onboarding" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hr_onboarding"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_hr_onboarding_org_id ON "hr_onboarding"(org_id);

-- 15. hr_reviews
ALTER TABLE "hr_reviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hr_reviews"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_hr_reviews_org_id ON "hr_reviews"(org_id);

-- 16. company_events
ALTER TABLE "company_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_events"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_company_events_org_id ON "company_events"(org_id);

-- 17. event_instances
ALTER TABLE "event_instances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "event_instances"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_event_instances_org_id ON "event_instances"(org_id);

-- 18. notifications
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON "notifications"(org_id);

-- 19. notification_preferences
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_preferences"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_org_id ON "notification_preferences"(org_id);

-- 20. projects
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "projects"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_projects_org_id ON "projects"(org_id);

-- 21. project_phases
ALTER TABLE "project_phases" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "project_phases"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_project_phases_org_id ON "project_phases"(org_id);

-- 22. safeguard_pending
ALTER TABLE "safeguard_pending" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safeguard_pending"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_safeguard_pending_org_id ON "safeguard_pending"(org_id);

-- 23. external_actions
ALTER TABLE "external_actions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "external_actions"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_external_actions_org_id ON "external_actions"(org_id);

-- 24. reports
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reports"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_reports_org_id ON "reports"(org_id);

-- 25. auto_review_queue
ALTER TABLE "auto_review_queue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "auto_review_queue"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_auto_review_queue_org_id ON "auto_review_queue"(org_id);

-- 26. escalation_events
ALTER TABLE "escalation_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "escalation_events"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_escalation_events_org_id ON "escalation_events"(org_id);

-- 27. mcp_integrations
ALTER TABLE "mcp_integrations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mcp_integrations"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_mcp_integrations_org_id ON "mcp_integrations"(org_id);

-- 28. hr_events
ALTER TABLE "hr_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hr_events"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_hr_events_org_id ON "hr_events"(org_id);

-- 29. hr_improvement_plans
ALTER TABLE "hr_improvement_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hr_improvement_plans"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_hr_improvement_plans_org_id ON "hr_improvement_plans"(org_id);

-- 30. wiki_articles
ALTER TABLE "wiki_articles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "wiki_articles"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_wiki_articles_org_id ON "wiki_articles"(org_id);

-- 31. wiki_article_versions
ALTER TABLE "wiki_article_versions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "wiki_article_versions"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_wiki_article_versions_org_id ON "wiki_article_versions"(org_id);

-- 32. project_archives
ALTER TABLE "project_archives" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "project_archives"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_project_archives_org_id ON "project_archives"(org_id);

-- 33. schedules
ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedules"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_schedules_org_id ON "schedules"(org_id);

-- 34. schedule_executions
ALTER TABLE "schedule_executions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_executions"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_schedule_executions_org_id ON "schedule_executions"(org_id);

-- 35. scheduler_state
ALTER TABLE "scheduler_state" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scheduler_state"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_scheduler_state_org_id ON "scheduler_state"(org_id);

-- 36. org_invitations (new table from 0003)
ALTER TABLE "org_invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "org_invitations"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_id ON "org_invitations"(org_id);

-- 37. org_secrets (new table from 0003)
ALTER TABLE "org_secrets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "org_secrets"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_org_secrets_org_id ON "org_secrets"(org_id);

-- 38. storage_objects (new table from 0003)
ALTER TABLE "storage_objects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "storage_objects"
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
CREATE INDEX IF NOT EXISTS idx_storage_objects_org_id ON "storage_objects"(org_id);
