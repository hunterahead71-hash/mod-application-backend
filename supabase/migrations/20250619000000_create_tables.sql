-- ==================== MOD ROLES TABLE ====================
CREATE TABLE IF NOT EXISTS public.mod_roles (
  id BIGSERIAL PRIMARY KEY,
  role_id TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS but allow service role (bypasses RLS)
ALTER TABLE public.mod_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all for authenticated (service role bypasses RLS anyway)
CREATE POLICY "Allow all for service role" ON public.mod_roles
  FOR ALL USING (true) WITH CHECK (true);

-- ==================== FIX TEST_QUESTIONS RLS ====================
-- If RLS blocks inserts, add permissive policy (service role bypasses RLS, but anon key does not)
ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for test_questions" ON public.test_questions;
CREATE POLICY "Allow all for test_questions" ON public.test_questions
  FOR ALL USING (true) WITH CHECK (true);

-- ==================== DM_TEMPLATES TABLE (optional) ====================
CREATE TABLE IF NOT EXISTS public.dm_templates (
  type TEXT PRIMARY KEY,
  title TEXT,
  body TEXT,
  footer TEXT,
  color_hex TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.dm_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all dm_templates" ON public.dm_templates
  FOR ALL USING (true) WITH CHECK (true);
