-- ============================================================================
-- Reports Sprint B/C: Cross Object Report Types, Jobs, Dashboard Cache
-- ============================================================================
-- Salesforce remains the source of business records. These tables store report
-- metadata, execution job metadata, dashboard cache, and standard report type
-- definitions only.

ALTER TABLE public.custom_report_types
  ADD COLUMN IF NOT EXISTS developer_name TEXT,
  ADD COLUMN IF NOT EXISTS is_standard BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_report_types_developer_name
  ON public.custom_report_types(developer_name)
  WHERE developer_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.report_export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  format TEXT NOT NULL DEFAULT 'csv',
  status TEXT NOT NULL DEFAULT 'queued',
  definition_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_name TEXT,
  result_text TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_export_jobs_format_check CHECK (format IN ('csv', 'xlsx')),
  CONSTRAINT report_export_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS public.dashboard_cache (
  cache_key TEXT PRIMARY KEY,
  dashboard_id UUID NOT NULL REFERENCES public.dashboards(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  result JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_export_jobs_report_user
  ON public.report_export_jobs(report_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_cache_dashboard_user
  ON public.dashboard_cache(dashboard_id, user_id);

INSERT INTO public.custom_report_types (developer_name, name, description, primary_object, definition, is_standard, is_active)
VALUES
  (
    'accounts',
    'Accounts',
    'Accounts only',
    'Account',
    '{"primaryObject":"Account","objects":[{"alias":"Account","object":"Account","label":"Account","relationship":"primary"}],"relationships":[]}'::jsonb,
    true,
    true
  ),
  (
    'accounts_with_contacts',
    'Accounts with Contacts',
    'Account records joined to related Contacts',
    'Account',
    '{"primaryObject":"Account","objects":[{"alias":"Account","object":"Account","label":"Account","relationship":"primary"},{"alias":"Contact","object":"Contact","label":"Contact","parentAlias":"Account","relationshipField":"AccountId"}],"relationships":[{"parentAlias":"Account","childAlias":"Contact","childObject":"Contact","parentField":"AccountId"}]}'::jsonb,
    true,
    true
  ),
  (
    'accounts_with_opportunities',
    'Accounts with Opportunities',
    'Account records joined to related Opportunities',
    'Account',
    '{"primaryObject":"Account","objects":[{"alias":"Account","object":"Account","label":"Account","relationship":"primary"},{"alias":"Opportunity","object":"Opportunity","label":"Opportunity","parentAlias":"Account","relationshipField":"AccountId"}],"relationships":[{"parentAlias":"Account","childAlias":"Opportunity","childObject":"Opportunity","parentField":"AccountId"}]}'::jsonb,
    true,
    true
  ),
  (
    'accounts_with_cases',
    'Accounts with Cases',
    'Account records joined to related Cases',
    'Account',
    '{"primaryObject":"Account","objects":[{"alias":"Account","object":"Account","label":"Account","relationship":"primary"},{"alias":"Case","object":"Case","label":"Case","parentAlias":"Account","relationshipField":"AccountId"}],"relationships":[{"parentAlias":"Account","childAlias":"Case","childObject":"Case","parentField":"AccountId"}]}'::jsonb,
    true,
    true
  ),
  (
    'campaigns_with_leads',
    'Campaigns with Leads',
    'Campaign records joined to related Leads through Lead.CampaignId',
    'Campaign',
    '{"primaryObject":"Campaign","objects":[{"alias":"Campaign","object":"Campaign","label":"Campaign","relationship":"primary"},{"alias":"Lead","object":"Lead","label":"Lead","parentAlias":"Campaign","relationshipField":"CampaignId"}],"relationships":[{"parentAlias":"Campaign","childAlias":"Lead","childObject":"Lead","parentField":"CampaignId"}]}'::jsonb,
    true,
    true
  )
ON CONFLICT (developer_name) WHERE developer_name IS NOT NULL DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  primary_object = EXCLUDED.primary_object,
  definition = EXCLUDED.definition,
  is_standard = EXCLUDED.is_standard,
  is_active = EXCLUDED.is_active,
  updated_at = now();
