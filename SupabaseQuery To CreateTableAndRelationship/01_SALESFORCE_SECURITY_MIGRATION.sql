-- =============================================================================
-- SaaSRAY CRM — Salesforce-Style Security Engine Master Migration
-- Run this ENTIRE file in Supabase SQL Editor (one shot)
-- Version: 2.0 (Salesforce Security Architecture)
-- =============================================================================

-- =============================================================================
-- STEP 0 — CLEANUP
-- =============================================================================

DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS record_teams CASCADE;
DROP TABLE IF EXISTS manual_record_shares CASCADE;
DROP TABLE IF EXISTS sharing_rules CASCADE;
DROP TABLE IF EXISTS queue_members CASCADE;
DROP TABLE IF EXISTS queues CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS public_groups CASCADE;
DROP TABLE IF EXISTS owd_settings CASCADE;
DROP TABLE IF EXISTS permission_set_field_permissions CASCADE;
DROP TABLE IF EXISTS profile_field_permissions CASCADE;
DROP TABLE IF EXISTS user_permission_set_group_assignments CASCADE;
DROP TABLE IF EXISTS muted_permissions CASCADE;
DROP TABLE IF EXISTS permission_set_group_members CASCADE;
DROP TABLE IF EXISTS permission_set_groups CASCADE;
DROP TABLE IF EXISTS user_permission_set_assignments CASCADE;
DROP TABLE IF EXISTS permission_set_object_perms CASCADE;
DROP TABLE IF EXISTS permission_sets CASCADE;
DROP TABLE IF EXISTS user_profile_assignments CASCADE;
DROP TABLE IF EXISTS profile_object_permissions CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS sf_objects CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

DROP FUNCTION IF EXISTS get_effective_permissions(UUID, TEXT);
DROP FUNCTION IF EXISTS update_updated_at_column();

-- =============================================================================
-- STEP 1 — AUTO-UPDATE TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- STEP 2 — FOUNDATION (ROLES & SF OBJECTS)
-- =============================================================================

CREATE TABLE roles (
  id             SERIAL PRIMARY KEY,
  name           TEXT UNIQUE NOT NULL,
  label          TEXT NOT NULL,
  description    TEXT,
  parent_role_id INT REFERENCES roles(id) ON DELETE SET NULL, -- Role Hierarchy
  sort_order     INT NOT NULL DEFAULT 0
);
COMMENT ON TABLE roles IS 'Role hierarchy for record visibility and management upward flow.';

CREATE TABLE sf_objects (
  id          SERIAL PRIMARY KEY,
  api_name    TEXT UNIQUE NOT NULL,
  label       TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0
);
COMMENT ON TABLE sf_objects IS 'Salesforce objects exposed by the portal.';

-- =============================================================================
-- STEP 3 — USERS
-- =============================================================================

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  name              TEXT NOT NULL,
  role_id           INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_pw    BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL
);
COMMENT ON TABLE users IS 'Portal users. Role references the roles hierarchy table.';
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- STEP 4 — PROFILES & OBJECT SECURITY (THE FLOOR)
-- =============================================================================

CREATE TABLE profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE profile_object_permissions (
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sf_object   TEXT NOT NULL,
  can_read    BOOLEAN NOT NULL DEFAULT FALSE,
  can_create  BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit    BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete  BOOLEAN NOT NULL DEFAULT FALSE,
  view_all    BOOLEAN NOT NULL DEFAULT FALSE, -- View all records in this object ignoring sharing
  modify_all  BOOLEAN NOT NULL DEFAULT FALSE, -- Modify all records in this object ignoring sharing
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, sf_object)
);
COMMENT ON TABLE profile_object_permissions IS 'Base CRUD and ViewAll/ModifyAll per object.';

CREATE TABLE user_profile_assignments (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- =============================================================================
-- STEP 5 — PERMISSION SETS (THE ADDITIVE CEILING)
-- =============================================================================

CREATE TABLE permission_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_permission_sets_updated_at BEFORE UPDATE ON permission_sets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE permission_set_object_perms (
  perm_set_id UUID NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
  sf_object   TEXT NOT NULL,
  can_read    BOOLEAN NOT NULL DEFAULT FALSE,
  can_create  BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit    BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete  BOOLEAN NOT NULL DEFAULT FALSE,
  view_all    BOOLEAN NOT NULL DEFAULT FALSE,
  modify_all  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (perm_set_id, sf_object)
);

CREATE TABLE user_permission_set_assignments (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm_set_id UUID NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, perm_set_id)
);

-- =============================================================================
-- STEP 6 — PERMISSION SET GROUPS & MUTING
-- =============================================================================

CREATE TABLE permission_set_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_permission_set_groups_updated_at BEFORE UPDATE ON permission_set_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE permission_set_group_members (
  group_id    UUID NOT NULL REFERENCES permission_set_groups(id) ON DELETE CASCADE,
  perm_set_id UUID NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, perm_set_id)
);

-- Muted permissions suppress specific capabilities from the group
CREATE TABLE muted_permissions (
  group_id    UUID NOT NULL REFERENCES permission_set_groups(id) ON DELETE CASCADE,
  sf_object   TEXT NOT NULL,
  mute_read   BOOLEAN NOT NULL DEFAULT FALSE,
  mute_create BOOLEAN NOT NULL DEFAULT FALSE,
  mute_edit   BOOLEAN NOT NULL DEFAULT FALSE,
  mute_delete BOOLEAN NOT NULL DEFAULT FALSE,
  mute_view_all BOOLEAN NOT NULL DEFAULT FALSE,
  mute_modify_all BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (group_id, sf_object)
);

CREATE TABLE user_permission_set_group_assignments (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    UUID NOT NULL REFERENCES permission_set_groups(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, group_id)
);

-- =============================================================================
-- STEP 7 — FIELD LEVEL SECURITY (FLS)
-- =============================================================================

CREATE TABLE profile_field_permissions (
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sf_object   TEXT NOT NULL,
  sf_field    TEXT NOT NULL,
  can_read    BOOLEAN NOT NULL DEFAULT TRUE,
  can_edit    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, sf_object, sf_field)
);

CREATE TABLE permission_set_field_permissions (
  perm_set_id UUID NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
  sf_object   TEXT NOT NULL,
  sf_field    TEXT NOT NULL,
  can_read    BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (perm_set_id, sf_object, sf_field)
);

-- =============================================================================
-- STEP 8 — RECORD LEVEL SECURITY (SHARING)
-- =============================================================================

CREATE TABLE owd_settings (
  sf_object       TEXT PRIMARY KEY,
  internal_access TEXT NOT NULL CHECK (internal_access IN ('Private', 'Public Read Only', 'Public Read/Write', 'Controlled by Parent')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE owd_settings IS 'Organization-Wide Defaults';

CREATE TABLE public_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id    UUID NOT NULL REFERENCES public_groups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE queues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  sf_object   TEXT NOT NULL, -- e.g. Lead, Case
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE queue_members (
  queue_id    UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id    UUID REFERENCES public_groups(id) ON DELETE CASCADE,
  CHECK ((user_id IS NOT NULL AND group_id IS NULL) OR (user_id IS NULL AND group_id IS NOT NULL))
);
COMMENT ON TABLE queue_members IS 'A queue member can be a user or a public group.';

CREATE TABLE sharing_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sf_object      TEXT NOT NULL,
  rule_type      TEXT NOT NULL CHECK (rule_type IN ('owner_based', 'criteria_based')),
  source_group_id UUID REFERENCES public_groups(id) ON DELETE CASCADE, -- For owner-based
  target_group_id UUID NOT NULL REFERENCES public_groups(id) ON DELETE CASCADE,
  access_level   TEXT NOT NULL CHECK (access_level IN ('Read', 'Read/Write')),
  criteria_json  JSONB, -- For criteria-based
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE manual_record_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sf_object       TEXT NOT NULL,
  record_id       TEXT NOT NULL, -- SF 18-char ID
  shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  shared_with_group_id UUID REFERENCES public_groups(id) ON DELETE CASCADE,
  access_level    TEXT NOT NULL CHECK (access_level IN ('Read', 'Read/Write')),
  shared_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((shared_with_user_id IS NOT NULL AND shared_with_group_id IS NULL) OR (shared_with_user_id IS NULL AND shared_with_group_id IS NOT NULL))
);

CREATE TABLE record_teams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sf_object       TEXT NOT NULL CHECK (sf_object IN ('Account', 'Opportunity', 'Case')),
  record_id       TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_role       TEXT NOT NULL,
  access_level    TEXT NOT NULL CHECK (access_level IN ('Read', 'Read/Write')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(record_id, user_id)
);

-- =============================================================================
-- STEP 9 — SESSIONS & AUDIT
-- =============================================================================

CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email  TEXT,
  action      TEXT NOT NULL,
  sf_object   TEXT,
  record_id   TEXT,
  payload     JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- STEP 10 — INDEXES
-- =============================================================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_pop_profile_id ON profile_object_permissions(profile_id);
CREATE INDEX idx_psop_perm_set_id ON permission_set_object_perms(perm_set_id);
CREATE INDEX idx_roles_parent ON roles(parent_role_id);
CREATE INDEX idx_manual_shares_record ON manual_record_shares(record_id);
CREATE INDEX idx_teams_record ON record_teams(record_id);
CREATE INDEX idx_fls_profile ON profile_field_permissions(profile_id, sf_object);

-- =============================================================================
-- STEP 11 — SEED DATA: Roles & Super Admin
-- =============================================================================

INSERT INTO roles (id, name, label, description, parent_role_id, sort_order) VALUES
  (1, 'system_administrator', 'System Administrator', 'Full system access', NULL, 1),
  (2, 'executive', 'Executive', 'C-Level access', 1, 2),
  (3, 'manager', 'Manager', 'Team lead', 2, 3),
  (4, 'employee', 'Employee', 'Standard user', 3, 4),
  (5, 'readonly', 'Read-Only', 'View-only access', 2, 5);

INSERT INTO sf_objects (api_name, label, sort_order) VALUES
  ('Account', 'Accounts', 1),
  ('Contact', 'Contacts', 2),
  ('Opportunity', 'Opportunities', 3),
  ('Lead', 'Leads', 4),
  ('Case', 'Cases', 5),
  ('Campaign', 'Campaigns', 6),
  ('Task', 'Tasks', 7),
  ('Event', 'Events', 8);

INSERT INTO owd_settings (sf_object, internal_access) VALUES
  ('Account', 'Private'),
  ('Contact', 'Private'),
  ('Opportunity', 'Private'),
  ('Lead', 'Private'),
  ('Case', 'Private'),
  ('Campaign', 'Public Read Only'),
  ('Task', 'Controlled by Parent'),
  ('Event', 'Controlled by Parent');

-- System Admin User (Password: Admin@1234!)
INSERT INTO users (id, email, password_hash, name, role_id, is_active, must_change_pw) VALUES
  ('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', 'superadmin@saasray.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TdxmQoysGAT4oiHO0i1EkXWi5W2O', 'System Administrator', 1, TRUE, TRUE);

INSERT INTO profiles (id, name, description) VALUES
  ('44444444-4444-4444-4444-444444444444', 'System Administrator Profile', 'Full access via profile');

INSERT INTO user_profile_assignments (user_id, profile_id) VALUES
  ('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', '44444444-4444-4444-4444-444444444444');

INSERT INTO profile_object_permissions (profile_id, sf_object, can_read, can_create, can_edit, can_delete, view_all, modify_all)
SELECT '44444444-4444-4444-4444-444444444444', api_name, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM sf_objects;

-- =============================================================================
-- STEP 12 — RESOLUTION FUNCTION (get_effective_permissions)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_effective_permissions(
  p_user_id UUID,
  p_sf_object TEXT
)
RETURNS TABLE (
  can_read BOOLEAN,
  can_create BOOLEAN,
  can_edit BOOLEAN,
  can_delete BOOLEAN,
  view_all BOOLEAN,
  modify_all BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_name TEXT;
BEGIN
  -- Check for System Administrator bypass
  SELECT r.name INTO v_role_name 
  FROM users u JOIN roles r ON u.role_id = r.id 
  WHERE u.id = p_user_id AND u.is_active = TRUE;

  IF v_role_name = 'system_administrator' THEN
    RETURN QUERY SELECT TRUE, TRUE, TRUE, TRUE, TRUE, TRUE;
    RETURN;
  END IF;

  RETURN QUERY
  WITH BasePerms AS (
    -- 1. Profile Perms
    SELECT pop.can_read, pop.can_create, pop.can_edit, pop.can_delete, pop.view_all, pop.modify_all
    FROM user_profile_assignments upa
    JOIN profile_object_permissions pop ON pop.profile_id = upa.profile_id
    WHERE upa.user_id = p_user_id AND pop.sf_object = p_sf_object
    
    UNION ALL
    
    -- 2. Direct Permission Sets
    SELECT psop.can_read, psop.can_create, psop.can_edit, psop.can_delete, psop.view_all, psop.modify_all
    FROM user_permission_set_assignments upsa
    JOIN permission_set_object_perms psop ON psop.perm_set_id = upsa.perm_set_id
    WHERE upsa.user_id = p_user_id AND psop.sf_object = p_sf_object
    
    UNION ALL

    -- 3. Grouped Permission Sets (accounting for muting)
    SELECT 
      psop.can_read AND NOT COALESCE(mp.mute_read, FALSE),
      psop.can_create AND NOT COALESCE(mp.mute_create, FALSE),
      psop.can_edit AND NOT COALESCE(mp.mute_edit, FALSE),
      psop.can_delete AND NOT COALESCE(mp.mute_delete, FALSE),
      psop.view_all AND NOT COALESCE(mp.mute_view_all, FALSE),
      psop.modify_all AND NOT COALESCE(mp.mute_modify_all, FALSE)
    FROM user_permission_set_group_assignments upga
    JOIN permission_set_group_members psgm ON psgm.group_id = upga.group_id
    JOIN permission_set_object_perms psop ON psop.perm_set_id = psgm.perm_set_id
    LEFT JOIN muted_permissions mp ON mp.group_id = upga.group_id AND mp.sf_object = psop.sf_object
    WHERE upga.user_id = p_user_id AND psop.sf_object = p_sf_object
  )
  SELECT 
    BOOL_OR(can_read), BOOL_OR(can_create), BOOL_OR(can_edit), BOOL_OR(can_delete), 
    BOOL_OR(view_all), BOOL_OR(modify_all)
  FROM BasePerms;
END;
$$;

-- =============================================================================
-- STEP 13 — HELPER FUNCTION (get_portal_users)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_portal_users()
RETURNS TABLE (
  id            UUID,
  email         TEXT,
  name          TEXT,
  role          TEXT,
  is_active     BOOLEAN,
  must_change_pw BOOLEAN,
  created_at    TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  profile_id    UUID,
  profile_name  TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    u.id,
    u.email,
    u.name,
    r.name AS role,
    u.is_active,
    u.must_change_pw,
    u.created_at,
    u.last_login_at,
    p.id   AS profile_id,
    p.name AS profile_name
  FROM users u
  JOIN roles r ON u.role_id = r.id
  LEFT JOIN user_profile_assignments upa ON upa.user_id = u.id
  LEFT JOIN profiles p ON p.id = upa.profile_id
  ORDER BY r.sort_order, u.name;
$$;
