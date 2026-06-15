-- ============================================================================
-- Remove Teams & Queues
--
-- Teams/Queues are no longer part of the portal security model. Keep the
-- Salesforce-style access order through Profiles, Permission Sets, FLS, OWD,
-- Role Hierarchy, Sharing Rules, Public Groups, and manual record shares.
-- ============================================================================

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

  IF v_owd_level = 'public_read' THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'owd'::TEXT;
    RETURN;
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

  RETURN QUERY SELECT FALSE, 'none'::TEXT, 'denied'::TEXT;
END;
$$;

GRANT ALL ON FUNCTION public.check_record_access(UUID, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.check_team_access(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_all_teams();
DROP FUNCTION IF EXISTS public.get_all_queues();

DROP TABLE IF EXISTS public.queue_items CASCADE;
DROP TABLE IF EXISTS public.queue_members CASCADE;
DROP TABLE IF EXISTS public.queues CASCADE;
DROP TABLE IF EXISTS public.record_team_assignments CASCADE;
DROP TABLE IF EXISTS public.team_members CASCADE;
DROP TABLE IF EXISTS public.teams CASCADE;
