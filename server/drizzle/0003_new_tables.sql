-- org_invitations table
CREATE TABLE IF NOT EXISTS "org_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "role" "org_role" NOT NULL DEFAULT 'member',
  "token_hash" text NOT NULL,
  "invited_by" uuid REFERENCES "users"("id"),
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_invitations_org_email_idx" ON "org_invitations" USING btree ("org_id","email");

-- org_secrets table
CREATE TABLE IF NOT EXISTS "org_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "key" varchar(100) NOT NULL,
  "encrypted_value" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_secrets_org_key_idx" ON "org_secrets" USING btree ("org_id","key");

-- storage_objects table
CREATE TABLE IF NOT EXISTS "storage_objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "object_key" text NOT NULL,
  "category" varchar(50) NOT NULL,
  "filename" varchar(500) NOT NULL,
  "content_type" varchar(255),
  "size_bytes" integer,
  "job_id" integer,
  "checksum" varchar(64),
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "storage_objects_key_idx" ON "storage_objects" USING btree ("object_key");
