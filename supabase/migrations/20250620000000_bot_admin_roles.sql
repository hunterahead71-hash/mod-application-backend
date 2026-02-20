-- ==================== BOT ADMIN ROLES TABLE ====================
-- Stores which Discord role IDs are allowed to use bot admin commands per guild.
-- No hardcoded admin roles; fully configurable via /add-admin-role and /delete-admin-role.

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

CREATE POLICY "Allow all for bot_admin_roles" ON public.bot_admin_roles
  FOR ALL USING (true) WITH CHECK (true);
