-- Ensure test_questions table has correct schema for add/edit/disable/delete
-- Run this if test_questions exists but lacks columns

-- Add order column if missing (for ordering questions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'test_questions' AND column_name = 'order'
  ) THEN
    ALTER TABLE public.test_questions ADD COLUMN "order" INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add enabled column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'test_questions' AND column_name = 'enabled'
  ) THEN
    ALTER TABLE public.test_questions ADD COLUMN enabled BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Add required_matches if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'test_questions' AND column_name = 'required_matches'
  ) THEN
    ALTER TABLE public.test_questions ADD COLUMN required_matches INTEGER DEFAULT 2;
  END IF;
END $$;

-- Ensure keywords supports array type
DO $$
BEGIN
  -- If keywords is text, we'd need to migrate - supabase usually uses jsonb for arrays
  NULL;
END $$;
