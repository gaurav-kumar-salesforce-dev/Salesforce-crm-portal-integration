-- ============================================================================
-- Create portal_record_pages table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.portal_record_pages (
    object_name TEXT PRIMARY KEY,
    layout TEXT NOT NULL,
    regions JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.portal_record_pages ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users
CREATE POLICY select_portal_record_pages ON public.portal_record_pages
    FOR SELECT TO authenticated USING (true);

-- Allow all operations to service_role (Node.js backend)
CREATE POLICY all_service_role_portal_record_pages ON public.portal_record_pages
    FOR ALL TO service_role USING (true);
