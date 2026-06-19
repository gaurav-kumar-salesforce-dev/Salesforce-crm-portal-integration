-- ============================================================================
-- Reports/Dashboards Performance, Cache, and Metrics
-- ============================================================================
-- Metadata and cache only. Salesforce remains the source of business records.

CREATE TABLE IF NOT EXISTS public.dashboard_component_cache (
  cache_key TEXT PRIMARY KEY,
  dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES public.dashboard_components(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  filter_hash TEXT NOT NULL DEFAULT '',
  result JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_component_cache_dashboard_user
  ON public.dashboard_component_cache(dashboard_id, user_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_component_cache_component
  ON public.dashboard_component_cache(component_id);

CREATE TABLE IF NOT EXISTS public.report_execution_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  dashboard_id UUID REFERENCES public.dashboards(id) ON DELETE SET NULL,
  component_id UUID REFERENCES public.dashboard_components(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  execution_type TEXT NOT NULL DEFAULT 'report',
  cache_key TEXT,
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  bypass_cache BOOLEAN NOT NULL DEFAULT false,
  sf_ms INTEGER,
  security_ms INTEGER,
  total_ms INTEGER,
  rows_returned INTEGER,
  rows_processed INTEGER,
  soql TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_execution_metrics_type_check
    CHECK (execution_type IN ('report', 'preview', 'dashboard', 'component', 'export', 'schedule')),
  CONSTRAINT report_execution_metrics_status_check
    CHECK (status IN ('success', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_report_execution_metrics_report_time
  ON public.report_execution_metrics(report_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_execution_metrics_dashboard_time
  ON public.report_execution_metrics(dashboard_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_execution_metrics_cache
  ON public.report_execution_metrics(cache_hit, created_at DESC);

CREATE TABLE IF NOT EXISTS public.dashboard_execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'success',
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  bypass_cache BOOLEAN NOT NULL DEFAULT false,
  total_ms INTEGER,
  components_total INTEGER NOT NULL DEFAULT 0,
  components_cached INTEGER NOT NULL DEFAULT 0,
  components_failed INTEGER NOT NULL DEFAULT 0,
  filters JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_execution_history_status_check CHECK (status IN ('success', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_dashboard_execution_history_dashboard_time
  ON public.dashboard_execution_history(dashboard_id, created_at DESC);

ALTER TABLE public.report_export_jobs
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_report_export_jobs_status_created
  ON public.report_export_jobs(status, created_at);

CREATE OR REPLACE FUNCTION public.cleanup_report_dashboard_runtime_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.dashboard_cache WHERE expires_at < now();
  DELETE FROM public.dashboard_component_cache WHERE expires_at < now();
  DELETE FROM public.report_execution_metrics WHERE created_at < now() - interval '90 days';
  DELETE FROM public.dashboard_execution_history WHERE created_at < now() - interval '90 days';
  DELETE FROM public.report_export_jobs
  WHERE created_at < now() - interval '30 days'
    AND status IN ('completed', 'failed');
END;
$$;
