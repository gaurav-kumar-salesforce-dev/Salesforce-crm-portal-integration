-- ============================================================================
-- Reports Builder Parity: Cross Filters, Chart Metadata, Folder Management
-- ============================================================================
-- Report definitions store crossFilters and expanded chart properties in JSONB.
-- Folder sharing/favorites are metadata-only; Salesforce business records remain
-- the source of report data.

COMMENT ON COLUMN public.reports.definition IS
  'JSON report definition. Supports tabular, summary, matrix, joined, bucket fields, formulas, conditional formatting, chart properties, and crossFilters.';

CREATE TABLE IF NOT EXISTS public.report_folder_favorites (
  folder_id UUID NOT NULL REFERENCES public.report_folders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.report_folder_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES public.report_folders(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  shared_with_role_id UUID REFERENCES public.org_roles(id) ON DELETE CASCADE,
  shared_with_group_id UUID REFERENCES public.public_groups(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'read',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_folder_shares_access_check CHECK (access_level IN ('read', 'edit')),
  CONSTRAINT report_folder_shares_target_check CHECK (
    num_nonnulls(shared_with_user_id, shared_with_role_id, shared_with_group_id) = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_report_folder_shares_folder
  ON public.report_folder_shares(folder_id);

CREATE INDEX IF NOT EXISTS idx_report_folder_shares_user
  ON public.report_folder_shares(shared_with_user_id);
