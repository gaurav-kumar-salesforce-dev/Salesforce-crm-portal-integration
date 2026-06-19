-- ============================================================================
-- Reports Sprint A: Remaining Phase 3 Metadata
-- ============================================================================
-- Advanced report configuration is stored in reports.definition JSONB:
--   bucketFields           -> derived bucket columns calculated at report runtime
--   rowFormulas            -> row-level numeric formulas calculated after FLS
--   summaryFormulas        -> aggregate-level formulas for summary/matrix outputs
--   conditionalFormatting  -> visual-only cell highlighting rules
--
-- Salesforce remains the source of business records. No Salesforce business
-- records are duplicated in Supabase.

COMMENT ON COLUMN public.reports.definition IS
  'JSON report definition. Supports tabular, summary, matrix, chart metadata, bucketFields, rowFormulas, summaryFormulas, and conditionalFormatting. Advanced fields are computed at runtime after security and FLS filtering.';
