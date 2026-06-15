-- ============================================================================
-- Reports Phase 3: Matrix Reports
-- ============================================================================
-- The foundation migration already allows reports.report_type = 'matrix'.
-- This phase stores matrix configuration in reports.definition JSONB:
--   groupBy       -> row grouping fields
--   groupColumns  -> column grouping fields
--   aggregates    -> matrix cell aggregate definitions
--
-- No Salesforce business data is duplicated in Supabase.

COMMENT ON COLUMN public.reports.definition IS
  'JSON report definition. Phase 3 supports tabular, summary, and matrix reports. Matrix reports use groupBy for row groups and groupColumns for column groups.';
