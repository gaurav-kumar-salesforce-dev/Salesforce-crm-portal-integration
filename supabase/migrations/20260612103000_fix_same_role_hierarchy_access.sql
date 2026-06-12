-- Fix Salesforce-style role hierarchy behavior:
-- users in the same org role do not inherit access to each other's records.
-- Only ancestor roles above the owner's role receive hierarchy access.

CREATE OR REPLACE FUNCTION public.is_above_in_hierarchy(
  p_viewer_user_id UUID,
  p_owner_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_viewer_path TEXT;
  v_owner_path  TEXT;
BEGIN
  SELECT r.path INTO v_viewer_path
  FROM public.users u
  JOIN public.org_roles r ON r.id = u.org_role_id
  WHERE u.id = p_viewer_user_id
    AND u.is_active = TRUE
    AND r.is_active = TRUE;

  SELECT r.path INTO v_owner_path
  FROM public.users u
  JOIN public.org_roles r ON r.id = u.org_role_id
  WHERE u.id = p_owner_user_id
    AND u.is_active = TRUE
    AND r.is_active = TRUE;

  IF v_viewer_path IS NULL OR v_owner_path IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN v_owner_path LIKE v_viewer_path || '/%';
END;
$$;

GRANT ALL ON FUNCTION public.is_above_in_hierarchy(UUID, UUID) TO anon;
GRANT ALL ON FUNCTION public.is_above_in_hierarchy(UUID, UUID) TO authenticated;
GRANT ALL ON FUNCTION public.is_above_in_hierarchy(UUID, UUID) TO service_role;
