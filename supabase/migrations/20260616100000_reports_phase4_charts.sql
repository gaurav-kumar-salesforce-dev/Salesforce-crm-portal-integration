-- ============================================================================
-- Reports Phase 4: Report Charts
-- ============================================================================
-- Report chart configuration is stored in reports.definition JSONB:
--   chart.enabled    -> whether the chart appears in the builder/report
--   chart.type       -> bar, line, or donut
--   chart.labelField -> source result field used for chart labels
--   chart.valueField -> source result field used for chart values
--
-- No Salesforce business data is duplicated in Supabase.

COMMENT ON COLUMN public.reports.definition IS
  'JSON report definition. Supports tabular, summary, matrix, and Phase 4 chart metadata in definition.chart.';
