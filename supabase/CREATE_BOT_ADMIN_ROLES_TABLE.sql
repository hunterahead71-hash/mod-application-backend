-- Run this in Supabase Dashboard: SQL Editor → New query → paste → Run
-- This creates the table required for /add-admin-role, /delete-admin-role, /show-admin-role

CREATE TABLE IF NOT EXISTS public.bot_admin_roles (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  role_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_admin_roles_guild ON public.bot_admin_roles(guild_id);

ALTER TABLE public.bot_admin_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for bot_admin_roles" ON public.bot_admin_roles;
CREATE POLICY "Allow all for bot_admin_roles" ON public.bot_admin_roles
  FOR ALL USING (true) WITH CHECK (true);
