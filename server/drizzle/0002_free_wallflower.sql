ALTER TABLE "agent_status" DROP CONSTRAINT "agent_status_pkey";--> statement-breakpoint
ALTER TABLE "hr_onboarding" DROP CONSTRAINT "hr_onboarding_pkey";--> statement-breakpoint
ALTER TABLE "agent_status" ADD CONSTRAINT "agent_status_business_id_agent_role_pk" PRIMARY KEY("business_id","agent_role");--> statement-breakpoint
ALTER TABLE "hr_onboarding" ADD CONSTRAINT "hr_onboarding_business_id_agent_role_pk" PRIMARY KEY("business_id","agent_role");