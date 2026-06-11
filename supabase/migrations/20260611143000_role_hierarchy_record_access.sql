-- Salesforce-style role hierarchy record access patch.
-- Run this in Supabase after the profile, permission set, and FLS schema is present.

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

  RETURN v_owner_path = v_viewer_path OR v_owner_path LIKE v_viewer_path || '/%';
END;
$$;

CREATE OR REPLACE FUNCTION public.check_record_access(
  p_user_id UUID,
  p_sf_object TEXT,
  p_record_id TEXT,
  p_owner_id TEXT
)
RETURNS TABLE (
  has_access BOOLEAN,
  access_level TEXT,
  access_via TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owd_level TEXT;
  v_viewer_role TEXT;
  v_owner_role TEXT;
  v_hierarchy_access BOOLEAN := FALSE;
  v_rule_access TEXT;
  v_manual_access TEXT;
  v_group_access BOOLEAN := FALSE;
  v_team_access TEXT;
BEGIN
  IF p_owner_id IS NOT NULL AND p_owner_id = p_user_id::TEXT THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owner'::TEXT;
    RETURN;
  END IF;

  SELECT access_level INTO v_owd_level
  FROM public.org_wide_defaults
  WHERE sf_object = p_sf_object;
  v_owd_level := COALESCE(v_owd_level, 'private');

  IF v_owd_level = 'public_read_write' THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owd'::TEXT;
    RETURN;
  END IF;

  IF v_owd_level = 'public_read' THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'owd'::TEXT;
    RETURN;
  END IF;

  IF p_owner_id IS NOT NULL AND p_owner_id <> '' THEN
    BEGIN
      SELECT public.is_above_in_hierarchy(p_user_id, p_owner_id::UUID)
      INTO v_hierarchy_access;

      IF v_hierarchy_access THEN
        RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'hierarchy'::TEXT;
        RETURN;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  SELECT role INTO v_viewer_role
  FROM public.users
  WHERE id = p_user_id;

  IF p_owner_id IS NOT NULL AND p_owner_id <> '' THEN
    BEGIN
      SELECT role INTO v_owner_role
      FROM public.users
      WHERE id = p_owner_id::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_owner_role := NULL;
    END;
  END IF;

  SELECT sr.access_level INTO v_rule_access
  FROM public.sharing_rules sr
  WHERE sr.sf_object = p_sf_object
    AND sr.is_active = TRUE
    AND sr.shared_with_role = v_viewer_role
    AND (sr.owner_role = v_owner_role OR sr.owner_role IS NULL)
  ORDER BY CASE sr.access_level WHEN 'edit' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_rule_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_rule_access, 'sharing_rule'::TEXT;
    RETURN;
  END IF;

  SELECT rs.access_level INTO v_manual_access
  FROM public.record_shares rs
  WHERE rs.sf_object = p_sf_object
    AND rs.record_id = p_record_id
    AND rs.shared_with = p_user_id
    AND (rs.expires_at IS NULL OR rs.expires_at > now())
  ORDER BY CASE rs.access_level WHEN 'edit' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_manual_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_manual_access, 'manual'::TEXT;
    RETURN;
  END IF;

  SELECT public.check_group_access(p_user_id, p_sf_object, p_record_id)
  INTO v_group_access;
  IF v_group_access THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'public_group'::TEXT;
    RETURN;
  END IF;

  SELECT ta.access_level INTO v_team_access
  FROM public.check_team_access(p_user_id, p_sf_object, p_record_id) ta
  LIMIT 1;

  IF v_team_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_team_access, 'team'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, 'none'::TEXT, 'denied'::TEXT;
END;
$$;

GRANT ALL ON FUNCTION public.is_above_in_hierarchy(UUID, UUID) TO anon;
GRANT ALL ON FUNCTION public.is_above_in_hierarchy(UUID, UUID) TO authenticated;
GRANT ALL ON FUNCTION public.is_above_in_hierarchy(UUID, UUID) TO service_role;

GRANT ALL ON FUNCTION public.check_record_access(UUID, TEXT, TEXT, TEXT) TO anon;
GRANT ALL ON FUNCTION public.check_record_access(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT ALL ON FUNCTION public.check_record_access(UUID, TEXT, TEXT, TEXT) TO service_role;
