-- ============================================================================
-- Permission Set Groups effective permission merge
--
-- Permission Set Groups are containers for Permission Sets. They grant the same
-- permissions as the included active permission sets, merged with profile and
-- direct permission set assignments using OR logic.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_effective_permissions(
  p_user_id UUID,
  p_sf_object TEXT
)
RETURNS TABLE (
  can_read BOOLEAN,
  can_create BOOLEAN,
  can_edit BOOLEAN,
  can_delete BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile_id UUID;
  v_is_system_admin BOOLEAN := FALSE;
BEGIN
  SELECT p.id, COALESCE(p.is_system_admin, FALSE)
    INTO v_profile_id, v_is_system_admin
  FROM public.user_profile_assignments upa
  JOIN public.profiles p ON p.id = upa.profile_id
  WHERE upa.user_id = p_user_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, FALSE;
    RETURN;
  END IF;

  IF v_is_system_admin THEN
    RETURN QUERY SELECT TRUE, TRUE, TRUE, TRUE;
    RETURN;
  END IF;

  RETURN QUERY
  WITH effective_permission_sets AS (
    SELECT upsa.perm_set_id
    FROM public.user_permission_set_assignments upsa
    WHERE upsa.user_id = p_user_id

    UNION

    SELECT psgm.perm_set_id
    FROM public.user_permission_set_group_assignments upsga
    JOIN public.permission_set_groups psg
      ON psg.id = upsga.group_id
     AND COALESCE(psg.is_active, TRUE) = TRUE
    JOIN public.permission_set_group_members psgm
      ON psgm.group_id = psg.id
    WHERE upsga.user_id = p_user_id
  ),
  profile_perms AS (
    SELECT
      COALESCE(pop.can_read, FALSE) AS can_read,
      COALESCE(pop.can_create, FALSE) AS can_create,
      COALESCE(pop.can_edit, FALSE) AS can_edit,
      COALESCE(pop.can_delete, FALSE) AS can_delete
    FROM public.profile_object_permissions pop
    WHERE pop.profile_id = v_profile_id
      AND pop.sf_object = p_sf_object
  ),
  permission_set_perms AS (
    SELECT
      COALESCE(psop.can_read, FALSE) AS can_read,
      COALESCE(psop.can_create, FALSE) AS can_create,
      COALESCE(psop.can_edit, FALSE) AS can_edit,
      COALESCE(psop.can_delete, FALSE) AS can_delete
    FROM effective_permission_sets eps
    JOIN public.permission_set_object_perms psop
      ON psop.perm_set_id = eps.perm_set_id
     AND psop.sf_object = p_sf_object
  ),
  all_perms AS (
    SELECT * FROM profile_perms
    UNION ALL
    SELECT * FROM permission_set_perms
  )
  SELECT
    COALESCE(BOOL_OR(all_perms.can_read), FALSE),
    COALESCE(BOOL_OR(all_perms.can_create), FALSE),
    COALESCE(BOOL_OR(all_perms.can_edit), FALSE),
    COALESCE(BOOL_OR(all_perms.can_delete), FALSE)
  FROM all_perms;
END;
$$;

COMMENT ON FUNCTION public.get_effective_permissions(UUID, TEXT)
IS 'Returns effective object CRUD permissions. Merges profile + direct permission sets + active permission set groups using OR logic.';

CREATE OR REPLACE FUNCTION public.get_effective_field_permissions(
  p_user_id UUID,
  p_sf_object TEXT
)
RETURNS TABLE (
  field_name TEXT,
  can_view BOOLEAN,
  can_edit BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH effective_permission_sets AS (
    SELECT upsa.perm_set_id
    FROM public.user_permission_set_assignments upsa
    WHERE upsa.user_id = p_user_id

    UNION

    SELECT psgm.perm_set_id
    FROM public.user_permission_set_group_assignments upsga
    JOIN public.permission_set_groups psg
      ON psg.id = upsga.group_id
     AND COALESCE(psg.is_active, TRUE) = TRUE
    JOIN public.permission_set_group_members psgm
      ON psgm.group_id = psg.id
    WHERE upsga.user_id = p_user_id
  )
  SELECT
    f.field_name,
    COALESCE(BOOL_OR(f.can_view), FALSE) AS can_view,
    COALESCE(BOOL_OR(f.can_edit), FALSE) AS can_edit
  FROM (
    SELECT fp.field_name, fp.can_view, fp.can_edit
    FROM public.user_profile_assignments upa
    JOIN public.field_permissions fp
      ON fp.profile_id = upa.profile_id
     AND fp.sf_object = p_sf_object
    WHERE upa.user_id = p_user_id

    UNION ALL

    SELECT fp.field_name, fp.can_view, fp.can_edit
    FROM effective_permission_sets eps
    JOIN public.field_permissions fp
      ON fp.permission_set_id = eps.perm_set_id
     AND fp.sf_object = p_sf_object
  ) f
  GROUP BY f.field_name;
END;
$$;

GRANT ALL ON FUNCTION public.get_effective_permissions(UUID, TEXT) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.get_effective_field_permissions(UUID, TEXT) TO anon, authenticated, service_role;
