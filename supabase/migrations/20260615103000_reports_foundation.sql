-- ============================================================================
-- Reports and Dashboards Phase 1 Foundation
-- Stores report metadata, folders, sharing, favorites, cache, and execution logs.
-- Salesforce remains the source of business records.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_folders_visibility_check CHECK (visibility IN ('private', 'public'))
);

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  folder_id UUID REFERENCES public.report_folders(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  report_type TEXT NOT NULL DEFAULT 'tabular',
  primary_object TEXT NOT NULL,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'private',
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT reports_report_type_check CHECK (report_type IN ('tabular', 'summary', 'matrix', 'joined')),
  CONSTRAINT reports_visibility_check CHECK (visibility IN ('private', 'public'))
);

CREATE TABLE IF NOT EXISTS public.report_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  definition JSONB NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.report_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  shared_with_role_id UUID REFERENCES public.org_roles(id) ON DELETE CASCADE,
  shared_with_group_id UUID REFERENCES public.public_groups(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'read',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_shares_access_level_check CHECK (access_level IN ('read', 'edit')),
  CONSTRAINT report_shares_target_check CHECK (
    num_nonnulls(shared_with_user_id, shared_with_role_id, shared_with_group_id) = 1
  )
);

CREATE TABLE IF NOT EXISTS public.report_favorites (
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  format TEXT NOT NULL DEFAULT 'csv',
  is_active BOOLEAN NOT NULL DEFAULT false,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_format_check CHECK (format IN ('csv', 'xlsx'))
);

CREATE TABLE IF NOT EXISTS public.report_cache (
  cache_key TEXT PRIMARY KEY,
  report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  result JSONB NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_execution_logs (
  id BIGSERIAL PRIMARY KEY,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'success',
  row_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_execution_logs_status_check CHECK (status IN ('success', 'error'))
);

CREATE TABLE IF NOT EXISTS public.custom_report_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  primary_object TEXT NOT NULL,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_folders_owner ON public.report_folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_reports_owner ON public.reports(owner_id);
CREATE INDEX IF NOT EXISTS idx_reports_folder ON public.reports(folder_id);
CREATE INDEX IF NOT EXISTS idx_reports_primary_object ON public.reports(primary_object);
CREATE INDEX IF NOT EXISTS idx_reports_deleted ON public.reports(deleted_at);
CREATE INDEX IF NOT EXISTS idx_report_shares_report ON public.report_shares(report_id);
CREATE INDEX IF NOT EXISTS idx_report_shares_user ON public.report_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_report_cache_report_user ON public.report_cache(report_id, user_id);
CREATE INDEX IF NOT EXISTS idx_report_execution_logs_report ON public.report_execution_logs(report_id, created_at DESC);
