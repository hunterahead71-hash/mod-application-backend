# Supabase Setup Instructions

Run the following SQL in your Supabase SQL Editor (Dashboard → SQL Editor → New Query):

```sql
-- ==================== MOD ROLES TABLE ====================
CREATE TABLE IF NOT EXISTS public.mod_roles (
  id BIGSERIAL PRIMARY KEY,
  role_id TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mod_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for service role" ON public.mod_roles;
CREATE POLICY "Allow all for mod_roles" ON public.mod_roles
  FOR ALL USING (true) WITH CHECK (true);

-- ==================== FIX TEST_QUESTIONS RLS ====================
ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for test_questions" ON public.test_questions;
CREATE POLICY "Allow all for test_questions" ON public.test_questions
  FOR ALL USING (true) WITH CHECK (true);

-- ==================== DM_TEMPLATES TABLE ====================
CREATE TABLE IF NOT EXISTS public.dm_templates (
  type TEXT PRIMARY KEY,
  title TEXT,
  body TEXT,
  footer TEXT,
  color_hex TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.dm_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all dm_templates" ON public.dm_templates;
CREATE POLICY "Allow all dm_templates" ON public.dm_templates
  FOR ALL USING (true) WITH CHECK (true);
```

## Environment Variables for Render

Set these in your Render dashboard:

- **DISCORD_GUILD_ID** = `1351362266246680626` (Void Esports server)
- **MOD_ROLE_ID** = Your role ID(s) to assign on acceptance (comma-separated if multiple)
