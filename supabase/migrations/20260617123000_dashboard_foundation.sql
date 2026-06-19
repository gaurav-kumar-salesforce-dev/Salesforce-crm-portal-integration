-- ============================================================================
-- Dashboard Sprint D1: Folder management and navigation metadata
-- ============================================================================
-- Dashboards store metadata only. Salesforce remains the source of business
-- data through saved reports.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.dashboard_folders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%visibility%'
  LOOP
    EXECUTE format('ALTER TABLE public.dashboard_folders DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.dashboard_folders
  ADD CONSTRAINT dashboard_folders_visibility_check
  CHECK (visibility IN ('private', 'public', 'shared'));

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.dashboards'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%visibility%'
  LOOP
    EXECUTE format('ALTER TABLE public.dashboards DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.dashboards
  ADD CONSTRAINT dashboards_visibility_check
  CHECK (visibility IN ('private', 'public', 'shared'));

CREATE TABLE IF NOT EXISTS public.dashboard_folder_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES public.dashboard_folders(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  shared_with_role_id UUID REFERENCES public.org_roles(id) ON DELETE CASCADE,
  shared_with_group_id UUID REFERENCES public.public_groups(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'read',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_folder_shares_access_level_check CHECK (access_level IN ('read', 'edit')),
  CONSTRAINT dashboard_folder_shares_target_check CHECK (
    num_nonnulls(shared_with_user_id, shared_with_role_id, shared_with_group_id) = 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_folder_shares_user_unique
  ON public.dashboard_folder_shares(folder_id, shared_with_user_id)
  WHERE shared_with_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_folder_shares_role_unique
  ON public.dashboard_folder_shares(folder_id, shared_with_role_id)
  WHERE shared_with_role_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_folder_shares_group_unique
  ON public.dashboard_folder_shares(folder_id, shared_with_group_id)
  WHERE shared_with_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dashboard_folder_shares_folder
  ON public.dashboard_folder_shares(folder_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_folder_shares_user
  ON public.dashboard_folder_shares(shared_with_user_id);

CREATE TABLE IF NOT EXISTS public.dashboard_folder_favorites (
  folder_id UUID NOT NULL REFERENCES public.dashboard_folders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_folder_favorites_user
  ON public.dashboard_folder_favorites(user_id);
