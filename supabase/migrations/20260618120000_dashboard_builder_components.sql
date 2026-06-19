-- ============================================================================
-- Dashboard Builder Components
-- ============================================================================
-- Dashboard components remain metadata only. Salesforce/report data is not
-- duplicated. This migration enables non-report widgets and richer component
-- types while preserving existing KPI/chart/table components.

ALTER TABLE public.dashboard_components
  ALTER COLUMN report_id DROP NOT NULL;

ALTER TABLE public.dashboard_components
  DROP CONSTRAINT IF EXISTS dashboard_components_type_check;

ALTER TABLE public.dashboard_components
  ADD CONSTRAINT dashboard_components_type_check
  CHECK (component_type IN ('kpi', 'chart', 'table', 'gauge', 'rich_text', 'image'));
