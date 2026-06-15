-- ============================================================================
-- Reports Phase 2: Summary Reports
-- No table changes required.
-- Existing reports.report_type already allows 'summary' and reports.definition
-- stores groupBy and aggregates JSON for the summary builder.
-- ============================================================================

COMMENT ON COLUMN public.reports.definition IS
  'Report definition JSON. Phase 2 supports summary fields: groupBy and aggregates.';
