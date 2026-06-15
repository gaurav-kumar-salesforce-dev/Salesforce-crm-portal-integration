


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."check_group_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_user_role_id UUID;
BEGIN
  -- Get user's org role
  SELECT org_role_id INTO v_user_role_id FROM users WHERE id = p_user_id;

  RETURN EXISTS (
    SELECT 1
    FROM record_shares rs
    JOIN public_groups pg ON pg.id = rs.shared_with_group
    JOIN public_group_members pgm ON pgm.group_id = pg.id
    WHERE rs.sf_object = p_sf_object
      AND rs.record_id = p_record_id
      AND pg.is_active = TRUE
      AND (rs.expires_at IS NULL OR rs.expires_at > now())
      AND (
        -- User is directly in the group
        (pgm.member_type = 'user' AND pgm.user_id = p_user_id)
        OR
        -- User's role is in the group
        (pgm.member_type = 'role' AND pgm.org_role_id = v_user_role_id)
      )
  );
END;
$$;


ALTER FUNCTION "public"."check_group_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_sharing_access"("p_user_id" "uuid", "p_user_role" "text", "p_sf_object" "text", "p_owner_id" "text") RETURNS TABLE("has_access" boolean, "access_level" "text", "access_via" "text")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_owd_level       TEXT;
  v_owner_role      TEXT;
  v_above           BOOLEAN;
  v_sharing_access  TEXT;
  v_manual_access   TEXT;
  v_team_access     TEXT;
BEGIN
  -- 1. Owner always has full access
  IF p_owner_id IS NOT NULL AND p_owner_id = p_user_id::TEXT THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owner'::TEXT; RETURN;
  END IF;

  -- 2. Get OWD
  SELECT access_level INTO v_owd_level
  FROM org_wide_defaults WHERE sf_object = p_sf_object;
  v_owd_level := COALESCE(v_owd_level, 'private');

  -- 3. Public OWD — everyone sees it
  IF v_owd_level = 'public_read_write' THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owd'::TEXT; RETURN;
  END IF;

  -- 4. Org role hierarchy check (path-based — works for any custom org)
  IF p_owner_id IS NOT NULL AND p_owner_id != '' THEN
    BEGIN
      SELECT is_above_in_hierarchy(p_user_id, p_owner_id::UUID) INTO v_above;
      IF v_above = TRUE THEN
        RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'hierarchy'::TEXT; RETURN;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- owner ID may not be a valid UUID (old records) — skip
      NULL;
    END;
  END IF;

  IF v_owd_level = 'public_read' THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'owd'::TEXT; RETURN;
  END IF;

  -- 5. Sharing rules — based on system role (admin/manager/etc)
  -- Get owner's system role
  IF p_owner_id IS NOT NULL AND p_owner_id != '' THEN
    BEGIN
      SELECT role INTO v_owner_role FROM users WHERE id = p_owner_id::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_owner_role := NULL;
    END;
  END IF;

  SELECT sr.access_level INTO v_sharing_access
  FROM sharing_rules sr
  WHERE sr.sf_object        = p_sf_object
    AND sr.is_active        = TRUE
    AND sr.shared_with_role = p_user_role
    AND (sr.owner_role      = v_owner_role OR sr.owner_role IS NULL)
  ORDER BY CASE sr.access_level WHEN 'edit' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_sharing_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_sharing_access, 'sharing_rule'::TEXT; RETURN;
  END IF;

  -- 6. Manual sharing
  SELECT rs.access_level INTO v_manual_access
  FROM record_shares rs
  WHERE rs.sf_object   = p_sf_object
    AND rs.record_id   = p_owner_id
    AND rs.shared_with = p_user_id
    AND (rs.expires_at IS NULL OR rs.expires_at > now())
  ORDER BY CASE rs.access_level WHEN 'edit' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_manual_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_manual_access, 'manual'::TEXT; RETURN;
  END IF;

  -- 7. Team access
  SELECT ta.access_level INTO v_team_access
  FROM check_team_access(p_user_id, p_sf_object, p_owner_id) ta
  LIMIT 1;

  IF v_team_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_team_access, 'team'::TEXT; RETURN;
  END IF;

  -- 8. No access
  RETURN QUERY SELECT FALSE, 'none'::TEXT, 'denied'::TEXT;
END;
$$;


ALTER FUNCTION "public"."check_sharing_access"("p_user_id" "uuid", "p_user_role" "text", "p_sf_object" "text", "p_owner_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_record_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text", "p_owner_id" "text") RETURNS TABLE("has_access" boolean, "access_level" "text", "access_via" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_owd_level TEXT;
  v_viewer_role TEXT;
  v_owner_role TEXT;
  v_hierarchy_access BOOLEAN := FALSE;
  v_manual_access TEXT;
  v_group_access BOOLEAN := FALSE;
  v_team_access TEXT;
BEGIN
  -- Object CRUD is evaluated by application code before this function is relevant.
  -- This function is only record visibility/editability.

  IF p_owner_id IS NOT NULL AND p_owner_id = p_user_id::TEXT THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owner'::TEXT; RETURN;
  END IF;

  SELECT access_level INTO v_owd_level
  FROM public.org_wide_defaults
  WHERE sf_object = p_sf_object;
  v_owd_level := COALESCE(v_owd_level, 'private');

  IF v_owd_level = 'public_read_write' THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owd'::TEXT; RETURN;
  END IF;

  IF p_owner_id IS NOT NULL AND p_owner_id <> '' THEN
    BEGIN
      SELECT public.is_above_in_hierarchy(p_user_id, p_owner_id::UUID)
      INTO v_hierarchy_access;

      IF v_hierarchy_access THEN
        RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'hierarchy'::TEXT; RETURN;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF v_owd_level = 'public_read' THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'owd'::TEXT; RETURN;
  END IF;

  SELECT role INTO v_viewer_role FROM public.users WHERE id = p_user_id;
  IF p_owner_id IS NOT NULL AND p_owner_id <> '' THEN
    BEGIN
      SELECT role INTO v_owner_role FROM public.users WHERE id = p_owner_id::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_owner_role := NULL;
    END;
  END IF;

  SELECT sr.access_level INTO v_manual_access
  FROM public.sharing_rules sr
  WHERE sr.sf_object = p_sf_object
    AND sr.is_active = TRUE
    AND sr.shared_with_role = v_viewer_role
    AND (sr.owner_role = v_owner_role OR sr.owner_role IS NULL)
  ORDER BY CASE sr.access_level WHEN 'edit' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_manual_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_manual_access, 'sharing_rule'::TEXT; RETURN;
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
    RETURN QUERY SELECT TRUE, v_manual_access, 'manual'::TEXT; RETURN;
  END IF;

  SELECT public.check_group_access(p_user_id, p_sf_object, p_record_id)
  INTO v_group_access;
  IF v_group_access THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'public_group'::TEXT; RETURN;
  END IF;

  SELECT ta.access_level INTO v_team_access
  FROM public.check_team_access(p_user_id, p_sf_object, p_record_id) ta
  LIMIT 1;

  IF v_team_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_team_access, 'team'::TEXT; RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, 'none'::TEXT, 'denied'::TEXT;
END;
$$;


ALTER FUNCTION "public"."check_record_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text", "p_owner_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_team_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") RETURNS TABLE("has_access" boolean, "access_level" "text", "team_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    TRUE::BOOLEAN,
    tm.access_level,
    t.name
  FROM record_team_assignments rta
  JOIN teams t          ON t.id      = rta.team_id
  JOIN team_members tm  ON tm.team_id = rta.team_id
                       AND tm.user_id = p_user_id
  WHERE rta.sf_object = p_sf_object
    AND rta.record_id = p_record_id
    AND t.is_active   = TRUE
  ORDER BY
    CASE tm.access_level WHEN 'full' THEN 1 WHEN 'edit' THEN 2 ELSE 3 END
  LIMIT 1;

  -- Also check if user is a queue member for this object
  -- (queue members can see unassigned records)
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      TRUE::BOOLEAN,
      'read'::TEXT,
      q.name
    FROM queue_items qi
    JOIN queues q       ON q.id      = qi.queue_id
    JOIN queue_members qm ON qm.queue_id = qi.queue_id
                          AND qm.user_id  = p_user_id
    WHERE qi.sf_object  = p_sf_object
      AND qi.record_id  = p_record_id
      AND qi.assigned_to IS NULL
      AND q.is_active   = TRUE
    LIMIT 1;
  END IF;
END;
$$;


ALTER FUNCTION "public"."check_team_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_org_role_path"("p_role_id" "uuid", "p_parent_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_parent_path TEXT;
BEGIN
  IF p_parent_id IS NULL THEN
    RETURN p_role_id::TEXT;
  END IF;

  SELECT path INTO v_parent_path FROM org_roles WHERE id = p_parent_id;
  RETURN v_parent_path || '/' || p_role_id::TEXT;
END;
$$;


ALTER FUNCTION "public"."compute_org_role_path"("p_role_id" "uuid", "p_parent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_queues"() RETURNS json
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN (
    SELECT json_agg(q_data)
    FROM (
      SELECT
        q.id,
        q.name,
        q.description,
        q.sf_object,
        q.is_active,
        q.created_at,
        (
          SELECT json_agg(json_build_object(
            'user_id', qm.user_id,
            'users',   json_build_object(
              'id',    u.id,
              'name',  u.name,
              'email', u.email
            )
          ))
          FROM queue_members qm
          JOIN users u ON u.id = qm.user_id
          WHERE qm.queue_id = q.id
        ) AS queue_members,
        (
          SELECT json_agg(json_build_object(
            'id',          qi.id,
            'record_id',   qi.record_id,
            'record_name', qi.record_name,
            'priority',    qi.priority,
            'assigned_to', qi.assigned_to,
            'assigned_at', qi.assigned_at
          ))
          FROM queue_items qi
          WHERE qi.queue_id = q.id
        ) AS queue_items
      FROM queues q
      ORDER BY q.name
    ) q_data
  );
END;
$$;


ALTER FUNCTION "public"."get_all_queues"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_teams"() RETURNS json
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN (
    SELECT json_agg(t_data)
    FROM (
      SELECT
        t.id,
        t.name,
        t.description,
        t.is_active,
        t.created_at,
        (
          SELECT json_agg(json_build_object(
            'id',           tm.id,
            'team_role',    tm.team_role,
            'access_level', tm.access_level,
            'user_id',      tm.user_id,
            'users',        json_build_object(
              'id',    u.id,
              'name',  u.name,
              'email', u.email,
              'role',  u.role
            )
          ))
          FROM team_members tm
          JOIN users u ON u.id = tm.user_id
          WHERE tm.team_id = t.id
        ) AS team_members
      FROM teams t
      ORDER BY t.name
    ) t_data
  );
END;
$$;


ALTER FUNCTION "public"."get_all_teams"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_effective_field_permissions"("p_user_id" "uuid", "p_sf_object" "text") RETURNS TABLE("field_name" "text", "can_view" boolean, "can_edit" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
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
     AND fp.sf_object  = p_sf_object
    WHERE upa.user_id = p_user_id

    UNION ALL

    SELECT fp.field_name, fp.can_view, fp.can_edit
    FROM effective_permission_sets eps
    JOIN public.field_permissions fp
      ON fp.permission_set_id = eps.perm_set_id
     AND fp.sf_object         = p_sf_object
  ) f
  GROUP BY f.field_name;
END;
$$;


ALTER FUNCTION "public"."get_effective_field_permissions"("p_user_id" "uuid", "p_sf_object" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_effective_permissions"("p_user_id" "uuid", "p_sf_object" "text") RETURNS TABLE("can_read" boolean, "can_create" boolean, "can_edit" boolean, "can_delete" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."get_effective_permissions"("p_user_id" "uuid", "p_sf_object" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_effective_permissions"("p_user_id" "uuid", "p_sf_object" "text") IS 'Returns effective object CRUD permissions. Merges profile + direct permission sets + active permission set groups using OR logic.';



CREATE OR REPLACE FUNCTION "public"."get_org_role_tree"() RETURNS json
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT COALESCE(json_agg(role_row ORDER BY (role_row->>'level')::int, (role_row->>'sort_order')::int, role_row->>'name'), '[]'::json)
  FROM (
    SELECT json_build_object(
      'id', r.id,
      'name', r.name,
      'api_name', r.api_name,
      'description', r.description,
      'report_name', r.report_name,
      'opportunity_access', r.opportunity_access,
      'parent_id', r.parent_id,
      'level', r.level,
      'path', r.path,
      'sort_order', COALESCE(r.sort_order, 0),
      'is_active', COALESCE(r.is_active, TRUE),
      'user_count', (
        SELECT COUNT(*)::int
        FROM public.users u
        WHERE u.org_role_id = r.id
          AND u.is_active = TRUE
      ),
      'total_subordinate_users', (
        SELECT COUNT(*)::int
        FROM public.users u
        JOIN public.org_roles sr ON sr.id = u.org_role_id
        WHERE sr.path LIKE r.path || '/%'
          AND u.is_active = TRUE
      )
    ) AS role_row
    FROM public.org_roles r
    WHERE COALESCE(r.is_active, TRUE) = TRUE
  ) rows;
$$;


ALTER FUNCTION "public"."get_org_role_tree"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_portal_users"() RETURNS TABLE("id" "uuid", "email" "text", "name" "text", "role" "text", "profile_image" "text", "is_active" boolean, "must_change_pw" boolean, "created_at" timestamp with time zone, "last_login_at" timestamp with time zone, "profile_id" "uuid", "profile_name" "text", "is_system_admin" boolean, "org_role_id" "uuid", "org_role_name" "text", "org_role_level" integer)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT
    u.id,
    u.email,
    u.name,
    u.role,
    u.profile_image,
    u.is_active,
    u.must_change_pw,
    u.created_at,
    u.last_login_at,
    p.id AS profile_id,
    p.name AS profile_name,
    COALESCE(p.is_system_admin, FALSE) AS is_system_admin,
    r.id AS org_role_id,
    r.name AS org_role_name,
    r.level AS org_role_level
  FROM public.users u
  LEFT JOIN public.user_profile_assignments upa ON upa.user_id = u.id
  LEFT JOIN public.profiles p ON p.id = upa.profile_id
  LEFT JOIN public.org_roles r ON r.id = u.org_role_id
  ORDER BY u.created_at DESC;
$$;


ALTER FUNCTION "public"."get_portal_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_subordinate_user_ids"("p_role_id" "uuid") RETURNS TABLE("user_id" "uuid")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_path TEXT;
BEGIN
  SELECT path INTO v_path FROM org_roles WHERE id = p_role_id;
  IF v_path IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT u.id
  FROM users u
  JOIN org_roles r ON r.id = u.org_role_id
  WHERE r.path LIKE v_path || '/%'
    AND u.is_active = TRUE;
END;
$$;


ALTER FUNCTION "public"."get_subordinate_user_ids"("p_role_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_above_in_hierarchy"("p_viewer_user_id" "uuid", "p_owner_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_viewer_path TEXT;
  v_owner_path  TEXT;
BEGIN
  -- Get viewer's role path
  SELECT r.path INTO v_viewer_path
  FROM users u
  JOIN org_roles r ON r.id = u.org_role_id
  WHERE u.id = p_viewer_user_id AND u.is_active = TRUE;

  -- Get owner's role path
  SELECT r.path INTO v_owner_path
  FROM users u
  JOIN org_roles r ON r.id = u.org_role_id
  WHERE u.id = p_owner_user_id AND u.is_active = TRUE;

  -- Neither has an org role assigned
  IF v_viewer_path IS NULL OR v_owner_path IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Salesforce role hierarchy grants access only to roles above the owner.
  -- Users in the same role do not inherit access to each other's records.
  RETURN v_owner_path LIKE v_viewer_path || '/%';
END;
$$;


ALTER FUNCTION "public"."is_above_in_hierarchy"("p_viewer_user_id" "uuid", "p_owner_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "user_email" "text",
    "user_role" "text",
    "action" "text" NOT NULL,
    "sf_object" "text",
    "record_id" "text",
    "payload" "jsonb",
    "ip_address" "inet",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log" IS 'Append-only audit trail. Every create/edit/delete through the portal is logged here. Never update or delete rows. Denormalized email/role ensures log is accurate even after user changes.';



CREATE SEQUENCE IF NOT EXISTS "public"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."audit_log_id_seq" OWNED BY "public"."audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."field_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "permission_set_id" "uuid",
    "sf_object" "text" NOT NULL,
    "field_name" "text" NOT NULL,
    "can_view" boolean DEFAULT false NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_field_perm_source" CHECK (((("profile_id" IS NOT NULL) AND ("permission_set_id" IS NULL)) OR (("profile_id" IS NULL) AND ("permission_set_id" IS NOT NULL))))
);


ALTER TABLE "public"."field_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "parent_id" "uuid",
    "level" integer DEFAULT 1 NOT NULL,
    "path" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "api_name" "text",
    "report_name" "text",
    "opportunity_access" "text" DEFAULT 'edit'::"text",
    CONSTRAINT "org_roles_opportunity_access_check" CHECK (("opportunity_access" = ANY (ARRAY['view'::"text", 'edit'::"text"])))
);


ALTER TABLE "public"."org_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_wide_defaults" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sf_object" "text" NOT NULL,
    "access_level" "text" DEFAULT 'private'::"text" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "org_wide_defaults_access_level_check" CHECK (("access_level" = ANY (ARRAY['private'::"text", 'public_read'::"text", 'public_read_write'::"text", 'controlled_by_parent'::"text"])))
);


ALTER TABLE "public"."org_wide_defaults" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."password_reset_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."password_reset_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permission_set_group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "perm_set_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permission_set_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permission_set_group_muting" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "sf_object" "text" NOT NULL,
    "field_name" "text",
    "muted_perm" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "permission_set_group_muting_muted_perm_check" CHECK (("muted_perm" = ANY (ARRAY['can_read'::"text", 'can_create'::"text", 'can_edit'::"text", 'can_delete'::"text", 'can_view_field'::"text", 'can_edit_field'::"text"])))
);


ALTER TABLE "public"."permission_set_group_muting" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permission_set_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."permission_set_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permission_set_object_perms" (
    "perm_set_id" "uuid" NOT NULL,
    "sf_object" "text" NOT NULL,
    "can_read" boolean DEFAULT false NOT NULL,
    "can_create" boolean DEFAULT false NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "can_delete" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permission_set_object_perms" OWNER TO "postgres";


COMMENT ON TABLE "public"."permission_set_object_perms" IS 'CRUD overrides per SF object per permission set. Merged with profile perms using OR logic at runtime.';



CREATE TABLE IF NOT EXISTS "public"."permission_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."permission_sets" OWNER TO "postgres";


COMMENT ON TABLE "public"."permission_sets" IS 'Additive permission overlays on top of a user profile. A user can have multiple. They only ADD permissions, never remove them.';



CREATE TABLE IF NOT EXISTS "public"."profile_object_permissions" (
    "profile_id" "uuid" NOT NULL,
    "sf_object" "text" NOT NULL,
    "can_read" boolean DEFAULT false NOT NULL,
    "can_create" boolean DEFAULT false NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "can_delete" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profile_object_permissions" OWNER TO "postgres";


COMMENT ON TABLE "public"."profile_object_permissions" IS 'CRUD flags per SF object per profile. One row per (profile, object) combo. These are the baseline permissions (the floor).';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "is_system_admin" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Named permission templates. Each user gets one profile as their baseline CRUD permissions across SF objects.';



CREATE TABLE IF NOT EXISTS "public"."public_group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "org_role_id" "uuid",
    "member_type" "text" DEFAULT 'user'::"text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "added_by" "uuid",
    CONSTRAINT "chk_group_member_source" CHECK (((("member_type" = 'user'::"text") AND ("user_id" IS NOT NULL) AND ("org_role_id" IS NULL)) OR (("member_type" = 'role'::"text") AND ("org_role_id" IS NOT NULL) AND ("user_id" IS NULL)))),
    CONSTRAINT "public_group_members_member_type_check" CHECK (("member_type" = ANY (ARRAY['user'::"text", 'role'::"text"])))
);


ALTER TABLE "public"."public_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."public_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."queue_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "queue_id" "uuid" NOT NULL,
    "sf_object" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "record_name" "text",
    "priority" integer DEFAULT 0 NOT NULL,
    "assigned_to" "uuid",
    "assigned_at" timestamp with time zone,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "added_by" "uuid"
);


ALTER TABLE "public"."queue_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."queue_members" (
    "queue_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "added_by" "uuid"
);


ALTER TABLE "public"."queue_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."queues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "sf_object" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."queues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."record_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sf_object" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "shared_by" "uuid" NOT NULL,
    "shared_with" "uuid",
    "access_level" "text" DEFAULT 'read'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "shared_with_group" "uuid",
    CONSTRAINT "record_shares_access_level_check" CHECK (("access_level" = ANY (ARRAY['read'::"text", 'edit'::"text"]))),
    CONSTRAINT "record_shares_target_check" CHECK (((("shared_with" IS NOT NULL) AND ("shared_with_group" IS NULL)) OR (("shared_with" IS NULL) AND ("shared_with_group" IS NOT NULL))))
);


ALTER TABLE "public"."record_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."record_team_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "sf_object" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid"
);


ALTER TABLE "public"."record_team_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "roles_name_check" CHECK (("name" = ANY (ARRAY['system_administrator'::"text", 'admin'::"text", 'manager'::"text", 'employee'::"text", 'readonly'::"text"])))
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


COMMENT ON TABLE "public"."roles" IS 'Fixed system roles. Never modified at runtime. Maps to role column in users table.';



CREATE SEQUENCE IF NOT EXISTS "public"."roles_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."roles_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."roles_id_seq" OWNED BY "public"."roles"."id";



CREATE TABLE IF NOT EXISTS "public"."sensitive_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sf_object" "text" NOT NULL,
    "field_name" "text" NOT NULL,
    "label" "text" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sensitive_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."sessions" IS 'Active JWT sessions. Allows server-side logout (set revoked_at). token_hash is SHA-256 of the actual JWT — raw token never stored.';



CREATE TABLE IF NOT EXISTS "public"."sf_objects" (
    "id" integer NOT NULL,
    "api_name" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."sf_objects" OWNER TO "postgres";


COMMENT ON TABLE "public"."sf_objects" IS 'Salesforce objects exposed by the portal. Drives the permission matrix UI.';



CREATE SEQUENCE IF NOT EXISTS "public"."sf_objects_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sf_objects_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sf_objects_id_seq" OWNED BY "public"."sf_objects"."id";



CREATE TABLE IF NOT EXISTS "public"."sharing_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "sf_object" "text" NOT NULL,
    "owner_role" "text",
    "shared_with_role" "text",
    "access_level" "text" DEFAULT 'read'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "owner_org_role_id" "uuid",
    "shared_with_org_role_id" "uuid",
    "shared_with_group_id" "uuid",
    "shared_with_type" "text" DEFAULT 'role'::"text" NOT NULL,
    CONSTRAINT "sharing_rules_access_level_check" CHECK (("access_level" = ANY (ARRAY['read'::"text", 'edit'::"text"]))),
    CONSTRAINT "sharing_rules_shared_with_type_check" CHECK (("shared_with_type" = ANY (ARRAY['role'::"text", 'public_group'::"text"])))
);


ALTER TABLE "public"."sharing_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "team_role" "text" DEFAULT 'member'::"text" NOT NULL,
    "access_level" "text" DEFAULT 'read'::"text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "added_by" "uuid",
    CONSTRAINT "team_members_access_level_check" CHECK (("access_level" = ANY (ARRAY['read'::"text", 'edit'::"text", 'full'::"text"]))),
    CONSTRAINT "team_members_team_role_check" CHECK (("team_role" = ANY (ARRAY['owner'::"text", 'editor'::"text", 'viewer'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_permission_set_assignments" (
    "user_id" "uuid" NOT NULL,
    "perm_set_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid"
);


ALTER TABLE "public"."user_permission_set_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_permission_set_assignments" IS 'Maps users to their permission sets (many-to-many). A user can have zero or many.';



CREATE TABLE IF NOT EXISTS "public"."user_permission_set_group_assignments" (
    "user_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid"
);


ALTER TABLE "public"."user_permission_set_group_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profile_assignments" (
    "user_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid"
);


ALTER TABLE "public"."user_profile_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_profile_assignments" IS 'Maps each user to exactly one profile. PK on user_id enforces one-profile-per-user. ON DELETE RESTRICT prevents deleting a profile that is in use.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" DEFAULT 'employee'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "must_change_pw" boolean DEFAULT false NOT NULL,
    "last_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "org_role_id" "uuid",
    "profile_image" "text"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'RLS enabled. Only accessible via service_role key (Node.js server). Anon key blocked.';



COMMENT ON COLUMN "public"."users"."role" IS 'System role: sets UI access ceiling. Actual SF object permissions come from profile + permission sets.';



COMMENT ON COLUMN "public"."users"."must_change_pw" IS 'Set TRUE when admin creates account with temp password. Login page checks this and forces password change.';



ALTER TABLE ONLY "public"."audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."roles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."roles_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sf_objects" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sf_objects_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."field_permissions"
    ADD CONSTRAINT "field_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_roles"
    ADD CONSTRAINT "org_roles_path_key" UNIQUE ("path");



ALTER TABLE ONLY "public"."org_roles"
    ADD CONSTRAINT "org_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_wide_defaults"
    ADD CONSTRAINT "org_wide_defaults_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_wide_defaults"
    ADD CONSTRAINT "org_wide_defaults_sf_object_key" UNIQUE ("sf_object");



ALTER TABLE ONLY "public"."password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."permission_set_group_members"
    ADD CONSTRAINT "permission_set_group_members_group_id_perm_set_id_key" UNIQUE ("group_id", "perm_set_id");



ALTER TABLE ONLY "public"."permission_set_group_members"
    ADD CONSTRAINT "permission_set_group_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_set_group_muting"
    ADD CONSTRAINT "permission_set_group_muting_group_id_sf_object_field_name_m_key" UNIQUE ("group_id", "sf_object", "field_name", "muted_perm");



ALTER TABLE ONLY "public"."permission_set_group_muting"
    ADD CONSTRAINT "permission_set_group_muting_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_set_groups"
    ADD CONSTRAINT "permission_set_groups_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."permission_set_groups"
    ADD CONSTRAINT "permission_set_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_set_object_perms"
    ADD CONSTRAINT "permission_set_object_perms_pkey" PRIMARY KEY ("perm_set_id", "sf_object");



ALTER TABLE ONLY "public"."permission_sets"
    ADD CONSTRAINT "permission_sets_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."permission_sets"
    ADD CONSTRAINT "permission_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_object_permissions"
    ADD CONSTRAINT "profile_object_permissions_pkey" PRIMARY KEY ("profile_id", "sf_object");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_group_members"
    ADD CONSTRAINT "public_group_members_group_id_org_role_id_key" UNIQUE ("group_id", "org_role_id");



ALTER TABLE ONLY "public"."public_group_members"
    ADD CONSTRAINT "public_group_members_group_id_user_id_key" UNIQUE ("group_id", "user_id");



ALTER TABLE ONLY "public"."public_group_members"
    ADD CONSTRAINT "public_group_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_groups"
    ADD CONSTRAINT "public_groups_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."public_groups"
    ADD CONSTRAINT "public_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."queue_items"
    ADD CONSTRAINT "queue_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."queue_items"
    ADD CONSTRAINT "queue_items_queue_id_record_id_key" UNIQUE ("queue_id", "record_id");



ALTER TABLE ONLY "public"."queue_members"
    ADD CONSTRAINT "queue_members_pkey" PRIMARY KEY ("queue_id", "user_id");



ALTER TABLE ONLY "public"."queues"
    ADD CONSTRAINT "queues_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."queues"
    ADD CONSTRAINT "queues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."record_shares"
    ADD CONSTRAINT "record_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."record_team_assignments"
    ADD CONSTRAINT "record_team_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."record_team_assignments"
    ADD CONSTRAINT "record_team_assignments_team_id_sf_object_record_id_key" UNIQUE ("team_id", "sf_object", "record_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sensitive_fields"
    ADD CONSTRAINT "sensitive_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sensitive_fields"
    ADD CONSTRAINT "sensitive_fields_sf_object_field_name_key" UNIQUE ("sf_object", "field_name");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."sf_objects"
    ADD CONSTRAINT "sf_objects_api_name_key" UNIQUE ("api_name");



ALTER TABLE ONLY "public"."sf_objects"
    ADD CONSTRAINT "sf_objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sharing_rules"
    ADD CONSTRAINT "sharing_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_user_id_key" UNIQUE ("team_id", "user_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."field_permissions"
    ADD CONSTRAINT "uq_field_perm_permset" UNIQUE ("permission_set_id", "sf_object", "field_name");



ALTER TABLE ONLY "public"."field_permissions"
    ADD CONSTRAINT "uq_field_perm_profile" UNIQUE ("profile_id", "sf_object", "field_name");



ALTER TABLE ONLY "public"."record_shares"
    ADD CONSTRAINT "uq_record_share" UNIQUE ("sf_object", "record_id", "shared_with");



ALTER TABLE ONLY "public"."sharing_rules"
    ADD CONSTRAINT "uq_sharing_rule" UNIQUE ("sf_object", "owner_role", "shared_with_role");



ALTER TABLE ONLY "public"."user_permission_set_assignments"
    ADD CONSTRAINT "user_permission_set_assignments_pkey" PRIMARY KEY ("user_id", "perm_set_id");



ALTER TABLE ONLY "public"."user_permission_set_group_assignments"
    ADD CONSTRAINT "user_permission_set_group_assignments_pkey" PRIMARY KEY ("user_id", "group_id");



ALTER TABLE ONLY "public"."user_profile_assignments"
    ADD CONSTRAINT "user_profile_assignments_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_audit_action" ON "public"."audit_log" USING "btree" ("action");



CREATE INDEX "idx_audit_created_at" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_sf_object" ON "public"."audit_log" USING "btree" ("sf_object");



CREATE INDEX "idx_audit_user_id" ON "public"."audit_log" USING "btree" ("user_id");



CREATE INDEX "idx_fp_permset_id" ON "public"."field_permissions" USING "btree" ("permission_set_id");



CREATE INDEX "idx_fp_profile_id" ON "public"."field_permissions" USING "btree" ("profile_id");



CREATE INDEX "idx_fp_sf_object" ON "public"."field_permissions" USING "btree" ("sf_object");



CREATE INDEX "idx_org_roles_level" ON "public"."org_roles" USING "btree" ("level");



CREATE INDEX "idx_org_roles_parent_id" ON "public"."org_roles" USING "btree" ("parent_id");



CREATE INDEX "idx_org_roles_path" ON "public"."org_roles" USING "btree" ("path");



CREATE INDEX "idx_pg_id" ON "public"."public_groups" USING "btree" ("id");



CREATE INDEX "idx_pgm_group_id" ON "public"."public_group_members" USING "btree" ("group_id");



CREATE INDEX "idx_pgm_role_id" ON "public"."public_group_members" USING "btree" ("org_role_id");



CREATE INDEX "idx_pgm_user_id" ON "public"."public_group_members" USING "btree" ("user_id");



CREATE INDEX "idx_pop_profile_id" ON "public"."profile_object_permissions" USING "btree" ("profile_id");



CREATE INDEX "idx_pop_sf_object" ON "public"."profile_object_permissions" USING "btree" ("sf_object");



CREATE INDEX "idx_prt_token_hash" ON "public"."password_reset_tokens" USING "btree" ("token_hash");



CREATE INDEX "idx_prt_user_id" ON "public"."password_reset_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_psgm_group_id" ON "public"."permission_set_group_members" USING "btree" ("group_id");



CREATE INDEX "idx_psgm_perm_set" ON "public"."permission_set_group_members" USING "btree" ("perm_set_id");



CREATE INDEX "idx_psgmt_group_id" ON "public"."permission_set_group_muting" USING "btree" ("group_id");



CREATE INDEX "idx_psop_perm_set_id" ON "public"."permission_set_object_perms" USING "btree" ("perm_set_id");



CREATE INDEX "idx_psop_sf_object" ON "public"."permission_set_object_perms" USING "btree" ("sf_object");



CREATE INDEX "idx_qi_assigned" ON "public"."queue_items" USING "btree" ("assigned_to");



CREATE INDEX "idx_qi_queue_id" ON "public"."queue_items" USING "btree" ("queue_id");



CREATE INDEX "idx_qi_record_id" ON "public"."queue_items" USING "btree" ("record_id");



CREATE INDEX "idx_qm_queue_id" ON "public"."queue_members" USING "btree" ("queue_id");



CREATE INDEX "idx_qm_user_id" ON "public"."queue_members" USING "btree" ("user_id");



CREATE INDEX "idx_rs_record_id" ON "public"."record_shares" USING "btree" ("record_id");



CREATE INDEX "idx_rs_sf_object" ON "public"."record_shares" USING "btree" ("sf_object");



CREATE INDEX "idx_rs_shared_with" ON "public"."record_shares" USING "btree" ("shared_with");


CREATE INDEX "idx_rs_shared_group" ON "public"."record_shares" USING "btree" ("shared_with_group");



CREATE INDEX "idx_rta_record_id" ON "public"."record_team_assignments" USING "btree" ("record_id");



CREATE INDEX "idx_rta_team_id" ON "public"."record_team_assignments" USING "btree" ("team_id");



CREATE INDEX "idx_sessions_expires_at" ON "public"."sessions" USING "btree" ("expires_at");



CREATE INDEX "idx_sessions_token_hash" ON "public"."sessions" USING "btree" ("token_hash");



CREATE INDEX "idx_sessions_user_id" ON "public"."sessions" USING "btree" ("user_id");



CREATE INDEX "idx_sr_owner_role" ON "public"."sharing_rules" USING "btree" ("owner_role");


CREATE INDEX "idx_sr_owner_org_role" ON "public"."sharing_rules" USING "btree" ("owner_org_role_id");



CREATE INDEX "idx_sr_sf_object" ON "public"."sharing_rules" USING "btree" ("sf_object");



CREATE INDEX "idx_sr_shared_with" ON "public"."sharing_rules" USING "btree" ("shared_with_role");


CREATE INDEX "idx_sr_shared_org_role" ON "public"."sharing_rules" USING "btree" ("shared_with_org_role_id");


CREATE INDEX "idx_sr_shared_group" ON "public"."sharing_rules" USING "btree" ("shared_with_group_id");



CREATE INDEX "idx_tm_team_id" ON "public"."team_members" USING "btree" ("team_id");



CREATE INDEX "idx_tm_user_id" ON "public"."team_members" USING "btree" ("user_id");



CREATE INDEX "idx_upa_profile_id" ON "public"."user_profile_assignments" USING "btree" ("profile_id");



CREATE INDEX "idx_upsa_perm_set_id" ON "public"."user_permission_set_assignments" USING "btree" ("perm_set_id");



CREATE INDEX "idx_upsa_user_id" ON "public"."user_permission_set_assignments" USING "btree" ("user_id");



CREATE INDEX "idx_upsg_group_id" ON "public"."user_permission_set_group_assignments" USING "btree" ("group_id");



CREATE INDEX "idx_upsg_user_id" ON "public"."user_permission_set_group_assignments" USING "btree" ("user_id");



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_is_active" ON "public"."users" USING "btree" ("is_active");



CREATE INDEX "idx_users_org_role_id" ON "public"."users" USING "btree" ("org_role_id");



CREATE INDEX "idx_users_role" ON "public"."users" USING "btree" ("role");



CREATE OR REPLACE TRIGGER "trg_permission_sets_updated_at" BEFORE UPDATE ON "public"."permission_sets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."field_permissions"
    ADD CONSTRAINT "field_permissions_permission_set_id_fkey" FOREIGN KEY ("permission_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."field_permissions"
    ADD CONSTRAINT "field_permissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_roles"
    ADD CONSTRAINT "org_roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_roles"
    ADD CONSTRAINT "org_roles_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."org_roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_wide_defaults"
    ADD CONSTRAINT "org_wide_defaults_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_set_group_members"
    ADD CONSTRAINT "permission_set_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."permission_set_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_set_group_members"
    ADD CONSTRAINT "permission_set_group_members_perm_set_id_fkey" FOREIGN KEY ("perm_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_set_group_muting"
    ADD CONSTRAINT "permission_set_group_muting_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."permission_set_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_set_groups"
    ADD CONSTRAINT "permission_set_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."permission_set_object_perms"
    ADD CONSTRAINT "permission_set_object_perms_perm_set_id_fkey" FOREIGN KEY ("perm_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_sets"
    ADD CONSTRAINT "permission_sets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profile_object_permissions"
    ADD CONSTRAINT "profile_object_permissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."public_group_members"
    ADD CONSTRAINT "public_group_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."public_group_members"
    ADD CONSTRAINT "public_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."public_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."public_group_members"
    ADD CONSTRAINT "public_group_members_org_role_id_fkey" FOREIGN KEY ("org_role_id") REFERENCES "public"."org_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."public_group_members"
    ADD CONSTRAINT "public_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."public_groups"
    ADD CONSTRAINT "public_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."queue_items"
    ADD CONSTRAINT "queue_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."queue_items"
    ADD CONSTRAINT "queue_items_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."queue_items"
    ADD CONSTRAINT "queue_items_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."queue_members"
    ADD CONSTRAINT "queue_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."queue_members"
    ADD CONSTRAINT "queue_members_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."queue_members"
    ADD CONSTRAINT "queue_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."queues"
    ADD CONSTRAINT "queues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."record_shares"
    ADD CONSTRAINT "record_shares_shared_by_fkey" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."record_shares"
    ADD CONSTRAINT "record_shares_shared_with_fkey" FOREIGN KEY ("shared_with") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."record_shares"
    ADD CONSTRAINT "record_shares_shared_with_group_fkey" FOREIGN KEY ("shared_with_group") REFERENCES "public"."public_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."record_team_assignments"
    ADD CONSTRAINT "record_team_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."record_team_assignments"
    ADD CONSTRAINT "record_team_assignments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sharing_rules"
    ADD CONSTRAINT "sharing_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."sharing_rules"
    ADD CONSTRAINT "sharing_rules_owner_org_role_id_fkey" FOREIGN KEY ("owner_org_role_id") REFERENCES "public"."org_roles"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."sharing_rules"
    ADD CONSTRAINT "sharing_rules_shared_with_org_role_id_fkey" FOREIGN KEY ("shared_with_org_role_id") REFERENCES "public"."org_roles"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."sharing_rules"
    ADD CONSTRAINT "sharing_rules_shared_with_group_id_fkey" FOREIGN KEY ("shared_with_group_id") REFERENCES "public"."public_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_permission_set_assignments"
    ADD CONSTRAINT "user_permission_set_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_permission_set_assignments"
    ADD CONSTRAINT "user_permission_set_assignments_perm_set_id_fkey" FOREIGN KEY ("perm_set_id") REFERENCES "public"."permission_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permission_set_assignments"
    ADD CONSTRAINT "user_permission_set_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permission_set_group_assignments"
    ADD CONSTRAINT "user_permission_set_group_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_permission_set_group_assignments"
    ADD CONSTRAINT "user_permission_set_group_assignments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."permission_set_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permission_set_group_assignments"
    ADD CONSTRAINT "user_permission_set_group_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profile_assignments"
    ADD CONSTRAINT "user_profile_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profile_assignments"
    ADD CONSTRAINT "user_profile_assignments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_profile_assignments"
    ADD CONSTRAINT "user_profile_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_org_role_id_fkey" FOREIGN KEY ("org_role_id") REFERENCES "public"."org_roles"("id") ON DELETE SET NULL;



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."field_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_wide_defaults" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permission_set_group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permission_set_group_muting" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permission_set_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permission_set_object_perms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permission_sets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_object_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."public_group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."public_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."queue_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."queue_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."queues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."record_shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."record_team_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sensitive_fields" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sf_objects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sharing_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_permission_set_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_permission_set_group_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profile_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."check_group_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_group_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_group_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_sharing_access"("p_user_id" "uuid", "p_user_role" "text", "p_sf_object" "text", "p_owner_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_sharing_access"("p_user_id" "uuid", "p_user_role" "text", "p_sf_object" "text", "p_owner_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_sharing_access"("p_user_id" "uuid", "p_user_role" "text", "p_sf_object" "text", "p_owner_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_record_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text", "p_owner_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_record_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text", "p_owner_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_record_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text", "p_owner_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_team_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_team_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_team_access"("p_user_id" "uuid", "p_sf_object" "text", "p_record_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_org_role_path"("p_role_id" "uuid", "p_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_org_role_path"("p_role_id" "uuid", "p_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_org_role_path"("p_role_id" "uuid", "p_parent_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_queues"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_queues"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_queues"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_teams"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_teams"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_teams"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_effective_field_permissions"("p_user_id" "uuid", "p_sf_object" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_effective_field_permissions"("p_user_id" "uuid", "p_sf_object" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_effective_field_permissions"("p_user_id" "uuid", "p_sf_object" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_effective_permissions"("p_user_id" "uuid", "p_sf_object" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_effective_permissions"("p_user_id" "uuid", "p_sf_object" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_effective_permissions"("p_user_id" "uuid", "p_sf_object" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_org_role_tree"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_org_role_tree"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_org_role_tree"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_portal_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_portal_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_portal_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_subordinate_user_ids"("p_role_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_subordinate_user_ids"("p_role_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_subordinate_user_ids"("p_role_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_above_in_hierarchy"("p_viewer_user_id" "uuid", "p_owner_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_above_in_hierarchy"("p_viewer_user_id" "uuid", "p_owner_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_above_in_hierarchy"("p_viewer_user_id" "uuid", "p_owner_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."field_permissions" TO "anon";
GRANT ALL ON TABLE "public"."field_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."field_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."org_roles" TO "anon";
GRANT ALL ON TABLE "public"."org_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."org_roles" TO "service_role";



GRANT ALL ON TABLE "public"."org_wide_defaults" TO "anon";
GRANT ALL ON TABLE "public"."org_wide_defaults" TO "authenticated";
GRANT ALL ON TABLE "public"."org_wide_defaults" TO "service_role";



GRANT ALL ON TABLE "public"."password_reset_tokens" TO "anon";
GRANT ALL ON TABLE "public"."password_reset_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."password_reset_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."permission_set_group_members" TO "anon";
GRANT ALL ON TABLE "public"."permission_set_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_set_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."permission_set_group_muting" TO "anon";
GRANT ALL ON TABLE "public"."permission_set_group_muting" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_set_group_muting" TO "service_role";



GRANT ALL ON TABLE "public"."permission_set_groups" TO "anon";
GRANT ALL ON TABLE "public"."permission_set_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_set_groups" TO "service_role";



GRANT ALL ON TABLE "public"."permission_set_object_perms" TO "anon";
GRANT ALL ON TABLE "public"."permission_set_object_perms" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_set_object_perms" TO "service_role";



GRANT ALL ON TABLE "public"."permission_sets" TO "anon";
GRANT ALL ON TABLE "public"."permission_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_sets" TO "service_role";



GRANT ALL ON TABLE "public"."profile_object_permissions" TO "anon";
GRANT ALL ON TABLE "public"."profile_object_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_object_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."public_group_members" TO "anon";
GRANT ALL ON TABLE "public"."public_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."public_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."public_groups" TO "anon";
GRANT ALL ON TABLE "public"."public_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."public_groups" TO "service_role";



GRANT ALL ON TABLE "public"."queue_items" TO "anon";
GRANT ALL ON TABLE "public"."queue_items" TO "authenticated";
GRANT ALL ON TABLE "public"."queue_items" TO "service_role";



GRANT ALL ON TABLE "public"."queue_members" TO "anon";
GRANT ALL ON TABLE "public"."queue_members" TO "authenticated";
GRANT ALL ON TABLE "public"."queue_members" TO "service_role";



GRANT ALL ON TABLE "public"."queues" TO "anon";
GRANT ALL ON TABLE "public"."queues" TO "authenticated";
GRANT ALL ON TABLE "public"."queues" TO "service_role";



GRANT ALL ON TABLE "public"."record_shares" TO "anon";
GRANT ALL ON TABLE "public"."record_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."record_shares" TO "service_role";



GRANT ALL ON TABLE "public"."record_team_assignments" TO "anon";
GRANT ALL ON TABLE "public"."record_team_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."record_team_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sensitive_fields" TO "anon";
GRANT ALL ON TABLE "public"."sensitive_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."sensitive_fields" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."sf_objects" TO "anon";
GRANT ALL ON TABLE "public"."sf_objects" TO "authenticated";
GRANT ALL ON TABLE "public"."sf_objects" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sf_objects_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sf_objects_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sf_objects_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sharing_rules" TO "anon";
GRANT ALL ON TABLE "public"."sharing_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."sharing_rules" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."user_permission_set_assignments" TO "anon";
GRANT ALL ON TABLE "public"."user_permission_set_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permission_set_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."user_permission_set_group_assignments" TO "anon";
GRANT ALL ON TABLE "public"."user_permission_set_group_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permission_set_group_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."user_profile_assignments" TO "anon";
GRANT ALL ON TABLE "public"."user_profile_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profile_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
























