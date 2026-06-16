-- ============================================================================
-- Reports Phase 5: Dashboard Foundation
-- ============================================================================
-- Dashboards store metadata and component layout only.
-- Salesforce remains the source of business data through saved reports.

CREATE TABLE IF NOT EXISTS public.dashboard_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_folders_visibility_check CHECK (visibility IN ('private', 'public'))
);

CREATE TABLE IF NOT EXISTS public.dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  folder_id UUID REFERENCES public.dashboard_folders(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  layout JSONB NOT NULL DEFAULT '{"columns":12,"rowHeight":90}'::jsonb,
  filters JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'private',
  theme TEXT NOT NULL DEFAULT 'light',
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT dashboards_visibility_check CHECK (visibility IN ('private', 'public'))
);

CREATE TABLE IF NOT EXISTS public.dashboard_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  component_type TEXT NOT NULL DEFAULT 'chart',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position_x INTEGER NOT NULL DEFAULT 0,
  position_y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 6,
  height INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_components_type_check CHECK (component_type IN ('kpi', 'chart', 'table'))
);

CREATE TABLE IF NOT EXISTS public.dashboard_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  shared_with_role_id UUID REFERENCES public.org_roles(id) ON DELETE CASCADE,
  shared_with_group_id UUID REFERENCES public.public_groups(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'read',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_shares_access_level_check CHECK (access_level IN ('read', 'edit')),
  CONSTRAINT dashboard_shares_target_check CHECK (
    num_nonnulls(shared_with_user_id, shared_with_role_id, shared_with_group_id) = 1
  )
);

CREATE TABLE IF NOT EXISTS public.dashboard_favorites (
  dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dashboard_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_folders_owner ON public.dashboard_folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON public.dashboards(owner_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_folder ON public.dashboards(folder_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_deleted ON public.dashboards(deleted_at);
CREATE INDEX IF NOT EXISTS idx_dashboard_components_dashboard ON public.dashboard_components(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_components_report ON public.dashboard_components(report_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_shares_dashboard ON public.dashboard_shares(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_shares_user ON public.dashboard_shares(shared_with_user_id);
