SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;


SELECT u.email, u.role,u.name, p.name AS profile
FROM users u
JOIN user_profile_assignments upa ON upa.user_id = u.id
JOIN profiles p ON p.id = upa.profile_id
ORDER BY u.role, u.email;

-- 3. Test permission resolution function for Sales Rep on Account
-- Expected: can_read=true, can_create=true, can_edit=true, can_delete=false
SELECT * FROM get_effective_permissions(
  'DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD',  -- salesrep@saasray.com
  'Account'
);

-- 4. Test permission resolution for Support Agent on Lead
-- Expected: can_read=true (from View All Leads perm set), can_create/edit/delete=false
SELECT * FROM get_effective_permissions(
  'EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE',  -- support@saasray.com
  'Lead'
);

-- 5. Test Manager on Account
-- Expected: can_read=true, can_create=true, can_edit=true, can_delete=true (perm set)
SELECT * FROM get_effective_permissions(
  'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',  -- manager@saasray.com
  'Account'
);

-- 6. Test Super Admin — always all TRUE
SELECT * FROM get_effective_permissions(
  'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',  -- superadmin@saasray.com
  'Campaign'
);





UPDATE users
SET password_hash = '$2b$12$L18BXRvKXLCNmklzanchGua3tBMVgAEggP4LuOfYhgKx/GxK53kla'
WHERE email = 'superadmin@saasray.com';


UPDATE users
SET password_hash = '$2b$12$L18BXRvKXLCNmklzanchGua3tBMVgAEggP4LuOfYhgKx/GxK53kla'
WHERE email IN (
  'admin@saasray.com',
  'manager@saasray.com',
  'salesrep@saasray.com',
  'support@saasray.com',
  'stakeholder@saasray.com'
);






-- Helper function: returns all users with their profile in one clean query
-- bypasses PostgREST relationship ambiguity entirely
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
    u.role,
    u.is_active,
    u.must_change_pw,
    u.created_at,
    u.last_login_at,
    p.id   AS profile_id,
    p.name AS profile_name
  FROM users u
  LEFT JOIN user_profile_assignments upa ON upa.user_id = u.id
  LEFT JOIN profiles p ON p.id = upa.profile_id
  ORDER BY u.created_at DESC;
$$;







CREATE TABLE password_reset_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_prt_user_id    ON password_reset_tokens(user_id);





-- ================================================================
-- FIELD LEVEL SECURITY TABLES
-- ================================================================

-- Stores field permission rules per profile per object
CREATE TABLE field_permissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  permission_set_id UUID      REFERENCES permission_sets(id) ON DELETE CASCADE,
  sf_object       TEXT        NOT NULL,
  field_name      TEXT        NOT NULL,
  can_view        BOOLEAN     NOT NULL DEFAULT FALSE,
  can_edit        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Either profile_id OR permission_set_id must be set, not both
  CONSTRAINT chk_field_perm_source CHECK (
    (profile_id IS NOT NULL AND permission_set_id IS NULL) OR
    (profile_id IS NULL AND permission_set_id IS NOT NULL)
  ),
  CONSTRAINT uq_field_perm_profile
    UNIQUE (profile_id, sf_object, field_name),
  CONSTRAINT uq_field_perm_permset
    UNIQUE (permission_set_id, sf_object, field_name)
);

CREATE INDEX idx_fp_profile_id   ON field_permissions(profile_id);
CREATE INDEX idx_fp_permset_id   ON field_permissions(permission_set_id);
CREATE INDEX idx_fp_sf_object    ON field_permissions(sf_object);

-- Stores which fields are considered sensitive per object
-- These are hidden by default unless explicitly granted
CREATE TABLE sensitive_fields (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  sf_object   TEXT    NOT NULL,
  field_name  TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  reason      TEXT,   -- e.g. "Financial data", "PII", "Internal only"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sf_object, field_name)
);

-- RLS
ALTER TABLE field_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_fields  ENABLE ROW LEVEL SECURITY;

-- Function to get effective field permissions for a user
CREATE OR REPLACE FUNCTION get_effective_field_permissions(
  p_user_id  UUID,
  p_sf_object TEXT
)
RETURNS TABLE (
  field_name TEXT,
  can_view   BOOLEAN,
  can_edit   BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = p_user_id AND is_active = TRUE;

  -- System administrator sees and edits everything
  IF v_role = 'system_administrator' THEN
    RETURN QUERY
      SELECT sf.field_name, TRUE::BOOLEAN, TRUE::BOOLEAN
      FROM sensitive_fields sf
      WHERE sf.sf_object = p_sf_object;
    RETURN;
  END IF;

  -- Merge profile + permission set field permissions using OR logic
  RETURN QUERY
  SELECT
    f.field_name,
    BOOL_OR(f.can_view) AS can_view,
    BOOL_OR(f.can_edit) AS can_edit
  FROM (
    -- From profile
    SELECT fp.field_name, fp.can_view, fp.can_edit
    FROM user_profile_assignments upa
    JOIN field_permissions fp
      ON fp.profile_id = upa.profile_id
     AND fp.sf_object  = p_sf_object
    WHERE upa.user_id = p_user_id

    UNION ALL

    -- From permission sets
    SELECT fp.field_name, fp.can_view, fp.can_edit
    FROM user_permission_set_assignments upsa
    JOIN field_permissions fp
      ON fp.permission_set_id = upsa.perm_set_id
     AND fp.sf_object         = p_sf_object
    WHERE upsa.user_id = p_user_id
  ) f
  GROUP BY f.field_name;
END;
$$;

-- Seed: common sensitive fields across CRM objects
INSERT INTO sensitive_fields (sf_object, field_name, label, reason) VALUES
  ('Account',     'AnnualRevenue',         'Annual Revenue',       'Financial data'),
  ('Account',     'NumberOfEmployees',      'Number of Employees',  'Company intelligence'),
  ('Account',     'Sic',                    'SIC Code',             'Internal classification'),
  ('Contact',     'Birthdate',              'Birthdate',            'PII'),
  ('Contact',     'MailingStreet',          'Mailing Street',       'PII'),
  ('Contact',     'MailingCity',            'Mailing City',         'PII'),
  ('Contact',     'MailingState',           'Mailing State',        'PII'),
  ('Contact',     'MailingPostalCode',      'Mailing Postal Code',  'PII'),
  ('Contact',     'MailingCountry',         'Mailing Country',      'PII'),
  ('Lead',        'AnnualRevenue',          'Annual Revenue',       'Financial data'),
  ('Lead',        'NumberOfEmployees',      'Number of Employees',  'Company intelligence'),
  ('Opportunity', 'Amount',                 'Amount',               'Financial data'),
  ('Opportunity', 'Probability',            'Probability',          'Internal metric'),
  ('Case',        'Internal_Comments__c',   'Internal Comments',    'Internal only');




-- ================================================================
-- RECORD OWNERSHIP CONFIG TABLE
-- Stores OWD (Organization Wide Defaults) per object
-- Controls who can see records by default
-- ================================================================

CREATE TABLE org_wide_defaults (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  sf_object   TEXT    UNIQUE NOT NULL,
  access_level TEXT   NOT NULL DEFAULT 'private'
              CHECK (access_level IN ('private','public_read','public_read_write','controlled_by_parent')),
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID    REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE org_wide_defaults ENABLE ROW LEVEL SECURITY;

-- Seed with default values (private = most secure, like Salesforce default)
INSERT INTO org_wide_defaults (sf_object, access_level, description) VALUES
  ('Account',     'public_read',  'Accounts visible to all but editable by owner'),
  ('Contact',     'private',      'Contacts visible to owner and above only'),
  ('Opportunity', 'private',      'Opportunities visible to owner and above only'),
  ('Lead',        'private',      'Leads visible to owner and above only'),
  ('Case',        'public_read',  'Cases visible to all support staff'),
  ('Campaign',    'public_read',  'Campaigns visible to all');

-- ================================================================
-- ROLE HIERARCHY TABLE
-- Defines who is above whom for record visibility
-- ================================================================

CREATE TABLE role_hierarchy (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name     TEXT    UNIQUE NOT NULL,
  parent_role   TEXT    REFERENCES role_hierarchy(role_name) ON DELETE SET NULL,
  level         INT     NOT NULL,
  label         TEXT    NOT NULL,
  can_see_subordinate_records BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE role_hierarchy ENABLE ROW LEVEL SECURITY;

-- Seed role hierarchy
INSERT INTO role_hierarchy (role_name, parent_role, level, label) VALUES
  ('system_administrator', NULL,                   1, 'System Administrator'),
  ('admin',                'system_administrator', 2, 'Admin'),
  ('manager',              'admin',                3, 'Manager'),
  ('employee',             'manager',              4, 'Employee'),
  ('readonly',             'employee',             5, 'Read Only');











  -- ================================================================
-- SHARING RULES + MANUAL SHARING TABLES
-- ================================================================

CREATE TABLE sharing_rules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  sf_object       TEXT        NOT NULL,
  -- Who owns the records being shared
  owner_role      TEXT        REFERENCES role_hierarchy(role_name) ON DELETE CASCADE,
  -- Who gets access
  shared_with_role TEXT       REFERENCES role_hierarchy(role_name) ON DELETE CASCADE,
  -- What access level is granted
  access_level    TEXT        NOT NULL DEFAULT 'read'
                  CHECK (access_level IN ('read','edit')),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_sharing_rule UNIQUE (sf_object, owner_role, shared_with_role)
);

CREATE INDEX idx_sr_sf_object      ON sharing_rules(sf_object);
CREATE INDEX idx_sr_owner_role     ON sharing_rules(owner_role);
CREATE INDEX idx_sr_shared_with    ON sharing_rules(shared_with_role);

-- Manual sharing — one-off record sharing between users
CREATE TABLE record_shares (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sf_object       TEXT        NOT NULL,
  record_id       TEXT        NOT NULL,  -- Salesforce record ID
  shared_by       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_with     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level    TEXT        NOT NULL DEFAULT 'read'
                  CHECK (access_level IN ('read','edit')),
  expires_at      TIMESTAMPTZ,           -- NULL = never expires
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_record_share UNIQUE (sf_object, record_id, shared_with)
);

CREATE INDEX idx_rs_sf_object   ON record_shares(sf_object);
CREATE INDEX idx_rs_record_id   ON record_shares(record_id);
CREATE INDEX idx_rs_shared_with ON record_shares(shared_with);

ALTER TABLE sharing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_shares ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- FUNCTION: Check if user can see a record via sharing rules
-- ================================================================
CREATE OR REPLACE FUNCTION check_sharing_access(
  p_user_id    UUID,
  p_user_role  TEXT,
  p_sf_object  TEXT,
  p_owner_id   TEXT   -- Portal_Owner__c value (user UUID as text)
)
RETURNS TABLE (
  has_access   BOOLEAN,
  access_level TEXT,
  access_via   TEXT   -- 'owner'|'hierarchy'|'sharing_rule'|'manual'|'owd'
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_owd_level       TEXT;
  v_owner_role      TEXT;
  v_owner_level     INT;
  v_user_level      INT;
  v_sharing_access  TEXT;
  v_manual_access   TEXT;
BEGIN
  -- 1. Owner always has access
  IF p_owner_id = p_user_id::TEXT THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owner'::TEXT;
    RETURN;
  END IF;

  -- 2. Get OWD
  SELECT access_level INTO v_owd_level
  FROM org_wide_defaults WHERE sf_object = p_sf_object;
  v_owd_level := COALESCE(v_owd_level, 'private');

  -- 3. Public access levels
  IF v_owd_level = 'public_read_write' THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owd'::TEXT; RETURN;
  END IF;
  IF v_owd_level = 'public_read' THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'owd'::TEXT; RETURN;
  END IF;

  -- 4. Role hierarchy check (private OWD — manager sees subordinates)
  IF p_owner_id IS NOT NULL AND p_owner_id != '' THEN
    SELECT role INTO v_owner_role FROM users WHERE id = p_owner_id::UUID;
    SELECT level INTO v_owner_level FROM role_hierarchy WHERE role_name = v_owner_role;
    SELECT level INTO v_user_level  FROM role_hierarchy WHERE role_name = p_user_role;

    IF v_user_level IS NOT NULL AND v_owner_level IS NOT NULL
       AND v_user_level < v_owner_level THEN
      RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'hierarchy'::TEXT; RETURN;
    END IF;
  END IF;

  -- 5. Sharing rules check
  SELECT sr.access_level INTO v_sharing_access
  FROM sharing_rules sr
  WHERE sr.sf_object = p_sf_object
    AND sr.is_active  = TRUE
    AND sr.shared_with_role = p_user_role
    AND (
      sr.owner_role = v_owner_role
      OR sr.owner_role IS NULL
    )
  ORDER BY
    CASE sr.access_level WHEN 'edit' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_sharing_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_sharing_access, 'sharing_rule'::TEXT; RETURN;
  END IF;

  -- 6. Manual sharing check
  SELECT rs.access_level INTO v_manual_access
  FROM record_shares rs
  WHERE rs.sf_object   = p_sf_object
    AND rs.record_id   = p_owner_id
    AND rs.shared_with = p_user_id
    AND (rs.expires_at IS NULL OR rs.expires_at > now())
  ORDER BY
    CASE rs.access_level WHEN 'edit' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_manual_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_manual_access, 'manual'::TEXT; RETURN;
  END IF;

  -- 7. No access
  RETURN QUERY SELECT FALSE, 'none'::TEXT, 'denied'::TEXT;
END;
$$;




-- ================================================================
-- PERMISSION SET GROUPS
-- ================================================================

CREATE TABLE permission_set_groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        UNIQUE NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

-- Which permission sets are inside each group
CREATE TABLE permission_set_group_members (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID    NOT NULL REFERENCES permission_set_groups(id) ON DELETE CASCADE,
  perm_set_id     UUID    NOT NULL REFERENCES permission_sets(id)       ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, perm_set_id)
);

-- Muting: suppress a specific permission inside a group
-- Even if a member perm set grants it, muting blocks it
CREATE TABLE permission_set_group_muting (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID    NOT NULL REFERENCES permission_set_groups(id) ON DELETE CASCADE,
  sf_object   TEXT    NOT NULL,
  field_name  TEXT,   -- NULL means muting applies to object permission, not field
  muted_perm  TEXT    NOT NULL
              CHECK (muted_perm IN ('can_read','can_create','can_edit','can_delete','can_view_field','can_edit_field')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, sf_object, field_name, muted_perm)
);

-- Assign groups to users (separate from individual perm set assignments)
CREATE TABLE user_permission_set_group_assignments (
  user_id     UUID    NOT NULL REFERENCES users(id)                ON DELETE CASCADE,
  group_id    UUID    NOT NULL REFERENCES permission_set_groups(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID    REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, group_id)
);

CREATE INDEX idx_psgm_group_id   ON permission_set_group_members(group_id);
CREATE INDEX idx_psgm_perm_set   ON permission_set_group_members(perm_set_id);
CREATE INDEX idx_psgmt_group_id  ON permission_set_group_muting(group_id);
CREATE INDEX idx_upsg_user_id    ON user_permission_set_group_assignments(user_id);
CREATE INDEX idx_upsg_group_id   ON user_permission_set_group_assignments(group_id);

ALTER TABLE permission_set_groups                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_set_group_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_set_group_muting              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permission_set_group_assignments    ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- UPDATE get_effective_permissions to include group permissions
-- with muting applied
-- ================================================================
CREATE OR REPLACE FUNCTION get_effective_permissions(
  p_user_id   UUID,
  p_sf_object TEXT
)
RETURNS TABLE (
  can_read    BOOLEAN,
  can_create  BOOLEAN,
  can_edit    BOOLEAN,
  can_delete  BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = p_user_id AND is_active = TRUE;

  IF v_role = 'system_administrator' THEN
    RETURN QUERY SELECT TRUE, TRUE, TRUE, TRUE;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    BOOL_OR(p.can_read)   AS can_read,
    BOOL_OR(p.can_create) AS can_create,
    BOOL_OR(p.can_edit)   AS can_edit,
    BOOL_OR(p.can_delete) AS can_delete
  FROM (
    -- Source 1: Profile permissions
    SELECT pop.can_read, pop.can_create, pop.can_edit, pop.can_delete
    FROM user_profile_assignments upa
    JOIN profile_object_permissions pop
      ON pop.profile_id = upa.profile_id
     AND pop.sf_object  = p_sf_object
    WHERE upa.user_id = p_user_id

    UNION ALL

    -- Source 2: Individual permission sets
    SELECT psop.can_read, psop.can_create, psop.can_edit, psop.can_delete
    FROM user_permission_set_assignments upsa
    JOIN permission_set_object_perms psop
      ON psop.perm_set_id = upsa.perm_set_id
     AND psop.sf_object   = p_sf_object
    WHERE upsa.user_id = p_user_id

    UNION ALL

    -- Source 3: Permission set GROUPS (with muting applied)
    SELECT
      CASE WHEN EXISTS (
        SELECT 1 FROM permission_set_group_muting m
        WHERE m.group_id = upsg.group_id
          AND m.sf_object = p_sf_object
          AND m.muted_perm = 'can_read'
          AND m.field_name IS NULL
      ) THEN FALSE ELSE psop.can_read END,

      CASE WHEN EXISTS (
        SELECT 1 FROM permission_set_group_muting m
        WHERE m.group_id = upsg.group_id
          AND m.sf_object = p_sf_object
          AND m.muted_perm = 'can_create'
          AND m.field_name IS NULL
      ) THEN FALSE ELSE psop.can_create END,

      CASE WHEN EXISTS (
        SELECT 1 FROM permission_set_group_muting m
        WHERE m.group_id = upsg.group_id
          AND m.sf_object = p_sf_object
          AND m.muted_perm = 'can_edit'
          AND m.field_name IS NULL
      ) THEN FALSE ELSE psop.can_edit END,

      CASE WHEN EXISTS (
        SELECT 1 FROM permission_set_group_muting m
        WHERE m.group_id = upsg.group_id
          AND m.sf_object = p_sf_object
          AND m.muted_perm = 'can_delete'
          AND m.field_name IS NULL
      ) THEN FALSE ELSE psop.can_delete END

    FROM user_permission_set_group_assignments upsg
    JOIN permission_set_group_members psgm
      ON psgm.group_id = upsg.group_id
    JOIN permission_set_object_perms psop
      ON psop.perm_set_id = psgm.perm_set_id
     AND psop.sf_object   = p_sf_object
    WHERE upsg.user_id = p_user_id
  ) p;
END;
$$;















-- ================================================================
-- TEAMS AND QUEUES
-- ================================================================

-- Teams: group of users working on a specific record
CREATE TABLE teams (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

-- Team members: who is in a team and what role they play
CREATE TABLE team_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_role   TEXT        NOT NULL DEFAULT 'member'
              CHECK (team_role IN ('owner','editor','viewer','member')),
  access_level TEXT       NOT NULL DEFAULT 'read'
              CHECK (access_level IN ('read','edit','full')),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (team_id, user_id)
);

-- Record team assignments: which team is working on which record
CREATE TABLE record_team_assignments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID        NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  sf_object   TEXT        NOT NULL,
  record_id   TEXT        NOT NULL,  -- Salesforce record ID
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (team_id, sf_object, record_id)
);

-- Queues: holding place for unassigned records
CREATE TABLE queues (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        UNIQUE NOT NULL,
  description TEXT,
  sf_object   TEXT        NOT NULL,  -- Which object this queue handles
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

-- Queue members: who can pick up records from this queue
CREATE TABLE queue_members (
  queue_id    UUID    NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  user_id     UUID    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by    UUID    REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (queue_id, user_id)
);

-- Queue items: records currently sitting in a queue
CREATE TABLE queue_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id    UUID        NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  sf_object   TEXT        NOT NULL,
  record_id   TEXT        NOT NULL,  -- Salesforce record ID
  record_name TEXT,                  -- Cached for display
  priority    INT         NOT NULL DEFAULT 0,
  assigned_to UUID        REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (queue_id, record_id)
);

CREATE INDEX idx_tm_team_id    ON team_members(team_id);
CREATE INDEX idx_tm_user_id    ON team_members(user_id);
CREATE INDEX idx_rta_team_id   ON record_team_assignments(team_id);
CREATE INDEX idx_rta_record_id ON record_team_assignments(record_id);
CREATE INDEX idx_qm_queue_id   ON queue_members(queue_id);
CREATE INDEX idx_qm_user_id    ON queue_members(user_id);
CREATE INDEX idx_qi_queue_id   ON queue_items(queue_id);
CREATE INDEX idx_qi_record_id  ON queue_items(record_id);
CREATE INDEX idx_qi_assigned   ON queue_items(assigned_to);

ALTER TABLE teams                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE queues                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_items             ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- FUNCTION: Check if user has team-based access to a record
-- ================================================================
CREATE OR REPLACE FUNCTION check_team_access(
  p_user_id   UUID,
  p_sf_object TEXT,
  p_record_id TEXT
)
RETURNS TABLE (
  has_access   BOOLEAN,
  access_level TEXT,
  team_name    TEXT
)
LANGUAGE plpgsql
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

-- ================================================================
-- UPDATE check_sharing_access to also include team access
-- ================================================================
CREATE OR REPLACE FUNCTION check_sharing_access(
  p_user_id    UUID,
  p_user_role  TEXT,
  p_sf_object  TEXT,
  p_owner_id   TEXT
)
RETURNS TABLE (
  has_access   BOOLEAN,
  access_level TEXT,
  access_via   TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_owd_level       TEXT;
  v_owner_role      TEXT;
  v_owner_level     INT;
  v_user_level      INT;
  v_sharing_access  TEXT;
  v_manual_access   TEXT;
  v_team_access     TEXT;
  v_team_name       TEXT;
BEGIN
  -- 1. Owner always has full access
  IF p_owner_id = p_user_id::TEXT THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owner'::TEXT; RETURN;
  END IF;

  -- 2. Get OWD
  SELECT access_level INTO v_owd_level
  FROM org_wide_defaults WHERE sf_object = p_sf_object;
  v_owd_level := COALESCE(v_owd_level, 'private');

  -- 3. Public OWD
  IF v_owd_level = 'public_read_write' THEN
    RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'owd'::TEXT; RETURN;
  END IF;
  IF v_owd_level = 'public_read' THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'owd'::TEXT; RETURN;
  END IF;

  -- 4. Role hierarchy
  IF p_owner_id IS NOT NULL AND p_owner_id != '' THEN
    SELECT role INTO v_owner_role FROM users WHERE id = p_owner_id::UUID;
    SELECT level INTO v_owner_level FROM role_hierarchy WHERE role_name = v_owner_role;
    SELECT level INTO v_user_level  FROM role_hierarchy WHERE role_name = p_user_role;
    IF v_user_level IS NOT NULL AND v_owner_level IS NOT NULL
       AND v_user_level < v_owner_level THEN
      RETURN QUERY SELECT TRUE, 'edit'::TEXT, 'hierarchy'::TEXT; RETURN;
    END IF;
  END IF;

  -- 5. Sharing rules
  SELECT sr.access_level INTO v_sharing_access
  FROM sharing_rules sr
  WHERE sr.sf_object        = p_sf_object
    AND sr.is_active        = TRUE
    AND sr.shared_with_role = p_user_role
    AND (sr.owner_role = v_owner_role OR sr.owner_role IS NULL)
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

  -- 7. Team access (new)
  SELECT ta.access_level, ta.team_name
  INTO v_team_access, v_team_name
  FROM check_team_access(p_user_id, p_sf_object, p_owner_id) ta
  LIMIT 1;

  IF v_team_access IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_team_access, 'team'::TEXT; RETURN;
  END IF;

  -- 8. No access
  RETURN QUERY SELECT FALSE, 'none'::TEXT, 'denied'::TEXT;
END;
$$;







CREATE OR REPLACE FUNCTION get_all_teams()
RETURNS JSON
LANGUAGE plpgsql
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
























CREATE OR REPLACE FUNCTION get_all_queues()
RETURNS JSON
LANGUAGE plpgsql
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















---------------------------------------------------------------------------------------------------------------------------
-- ================================================================
-- SAASRAY CRM — ROLE HIERARCHY (Salesforce-Style)
-- Run this ENTIRELY in Supabase SQL Editor
--
-- KEY CONCEPT (from Salesforce):
-- Roles = DATA ACCESS levels, NOT job titles
-- Every org defines their OWN roles (fully custom)
-- Higher roles see records owned by ALL roles below them
-- Same-level roles CANNOT see each other's records
-- This is SEPARATE from system_role (admin/employee/etc)
-- ================================================================

-- Step 1: Drop old fixed role_hierarchy table if exists
DROP TABLE IF EXISTS role_hierarchy CASCADE;

-- Step 2: Drop old org_roles if exists from previous attempt
DROP TABLE IF EXISTS org_roles CASCADE;

-- Step 3: Remove old column if exists
ALTER TABLE users DROP COLUMN IF EXISTS org_role_id;

-- ================================================================
-- FRESH TABLE: org_roles
-- Fully custom, org-defined roles
-- Any org can create: CEO, VP Sales, Regional Manager, etc.
-- ================================================================
CREATE TABLE org_roles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,                    -- "CEO", "VP Sales", "Sales Rep"
  description   TEXT,                                    -- Optional description
  parent_id     UUID        REFERENCES org_roles(id)     -- Reports To
                            ON DELETE SET NULL,
  level         INT         NOT NULL DEFAULT 1,          -- Auto-computed depth (1=top)
  path          TEXT        NOT NULL DEFAULT '',         -- Materialized path for fast hierarchy queries
  sort_order    INT         NOT NULL DEFAULT 0,          -- Display order within siblings
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,

  -- Constraint: path must be unique
  UNIQUE(path)
);

CREATE INDEX idx_org_roles_parent_id ON org_roles(parent_id);
CREATE INDEX idx_org_roles_path      ON org_roles(path);
CREATE INDEX idx_org_roles_level     ON org_roles(level);

ALTER TABLE org_roles ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- Add org_role_id to users table
-- ================================================================
ALTER TABLE users ADD COLUMN org_role_id UUID
  REFERENCES org_roles(id) ON DELETE SET NULL;

CREATE INDEX idx_users_org_role_id ON users(org_role_id);

-- ================================================================
-- FUNCTION: Compute path for a role
-- Called when creating/moving a role
-- Path format: "uuid1/uuid2/uuid3" (ancestor IDs joined by /)
-- ================================================================
CREATE OR REPLACE FUNCTION compute_org_role_path(p_role_id UUID, p_parent_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
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

-- ================================================================
-- FUNCTION: Get role tree with user counts (for admin panel display)
-- Returns flat list — frontend builds tree from parent_id
-- ================================================================
CREATE OR REPLACE FUNCTION get_org_role_tree()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(r_data ORDER BY (r_data->>'level')::int, (r_data->>'sort_order')::int, r_data->>'name'), '[]'::json)
    FROM (
      SELECT json_build_object(
        'id',          r.id,
        'name',        r.name,
        'description', r.description,
        'parent_id',   r.parent_id,
        'level',       r.level,
        'path',        r.path,
        'sort_order',  r.sort_order,
        'is_active',   r.is_active,
        'created_at',  r.created_at,
        'user_count',  (
          SELECT COUNT(*)::int
          FROM users u
          WHERE u.org_role_id = r.id
            AND u.is_active   = TRUE
        ),
        'total_subordinate_users', (
          SELECT COUNT(*)::int
          FROM users u
          JOIN org_roles sr ON sr.id = u.org_role_id
          WHERE sr.path LIKE r.path || '/%'
            AND u.is_active = TRUE
        )
      ) AS r_data
      FROM org_roles r
      WHERE r.is_active = TRUE
    ) sub
  );
END;
$$;

-- ================================================================
-- FUNCTION: Is user A above user B in the hierarchy?
-- Used for record visibility check
-- ================================================================
CREATE OR REPLACE FUNCTION is_above_in_hierarchy(
  p_viewer_user_id UUID,
  p_owner_user_id  UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
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

  -- Owner's path starts with viewer's path = viewer is above owner
  RETURN v_owner_path LIKE v_viewer_path || '/%';
END;
$$;

-- ================================================================
-- FUNCTION: Get all users in roles below a given role
-- Used for "My Team" filters and reports
-- ================================================================
CREATE OR REPLACE FUNCTION get_subordinate_user_ids(p_role_id UUID)
RETURNS TABLE(user_id UUID)
LANGUAGE plpgsql
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

-- ================================================================
-- UPDATE get_portal_users to include org role info
-- ================================================================
CREATE OR REPLACE FUNCTION get_portal_users()
RETURNS TABLE (
  id              UUID,
  email           TEXT,
  name            TEXT,
  role            TEXT,
  is_active       BOOLEAN,
  must_change_pw  BOOLEAN,
  created_at      TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  profile_id      UUID,
  profile_name    TEXT,
  org_role_id     UUID,
  org_role_name   TEXT,
  org_role_level  INT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    u.id,
    u.email,
    u.name,
    u.role,
    u.is_active,
    u.must_change_pw,
    u.created_at,
    u.last_login_at,
    p.id        AS profile_id,
    p.name      AS profile_name,
    r.id        AS org_role_id,
    r.name      AS org_role_name,
    r.level     AS org_role_level
  FROM users u
  LEFT JOIN user_profile_assignments upa ON upa.user_id = u.id
  LEFT JOIN profiles p   ON p.id  = upa.profile_id
  LEFT JOIN org_roles r  ON r.id  = u.org_role_id
  ORDER BY u.created_at DESC;
$$;

-- ================================================================
-- UPDATE check_sharing_access to use path-based hierarchy
-- Replaces the old fixed role_hierarchy approach
-- ================================================================
CREATE OR REPLACE FUNCTION check_sharing_access(
  p_user_id    UUID,
  p_user_role  TEXT,
  p_sf_object  TEXT,
  p_owner_id   TEXT
)
RETURNS TABLE (
  has_access   BOOLEAN,
  access_level TEXT,
  access_via   TEXT
)
LANGUAGE plpgsql
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
  IF v_owd_level = 'public_read' THEN
    RETURN QUERY SELECT TRUE, 'read'::TEXT, 'owd'::TEXT; RETURN;
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










-- Add missing Salesforce fields to org_roles
ALTER TABLE org_roles
  ADD COLUMN IF NOT EXISTS api_name        TEXT,   -- "VP_of_Sales" auto from label
  ADD COLUMN IF NOT EXISTS report_name     TEXT,   -- "VP Sales" short for reports
  ADD COLUMN IF NOT EXISTS opportunity_access TEXT  -- 'view' or 'edit'
    DEFAULT 'edit'
    CHECK (opportunity_access IN ('view','edit'));

-- Update existing roles with api_name
UPDATE org_roles
SET api_name = REGEXP_REPLACE(LOWER(name), '[^a-z0-9]+', '_', 'g')
WHERE api_name IS NULL;








CREATE OR REPLACE FUNCTION get_org_role_tree()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(r_data ORDER BY (r_data->>'level')::int, (r_data->>'sort_order')::int, r_data->>'name'), '[]'::json)
    FROM (
      SELECT json_build_object(
        'id',                r.id,
        'name',              r.name,
        'api_name',          r.api_name,
        'description',       r.description,
        'report_name',       r.report_name,
        'opportunity_access',r.opportunity_access,
        'parent_id',         r.parent_id,
        'level',             r.level,
        'path',              r.path,
        'sort_order',        r.sort_order,
        'is_active',         r.is_active,
        'created_at',        r.created_at,
        'user_count',        (SELECT COUNT(*)::int FROM users u WHERE u.org_role_id = r.id AND u.is_active = TRUE),
        'total_subordinate_users', (SELECT COUNT(*)::int FROM users u JOIN org_roles sr ON sr.id = u.org_role_id WHERE sr.path LIKE r.path || '/%' AND u.is_active = TRUE)
      ) AS r_data
      FROM org_roles r
      WHERE r.is_active = TRUE
    ) sub
  );
END;
$$;










-- ================================================================
-- PUBLIC GROUPS
-- Groups of users/roles for easy sharing
-- ================================================================
CREATE TABLE public_groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        UNIQUE NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

-- Group members can be individual users OR entire roles
CREATE TABLE public_group_members (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID    NOT NULL REFERENCES public_groups(id) ON DELETE CASCADE,
  -- Either user_id OR org_role_id must be set
  user_id         UUID    REFERENCES users(id)     ON DELETE CASCADE,
  org_role_id     UUID    REFERENCES org_roles(id) ON DELETE CASCADE,
  member_type     TEXT    NOT NULL DEFAULT 'user'
                  CHECK (member_type IN ('user','role')),
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by        UUID    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_group_member_source CHECK (
    (member_type = 'user' AND user_id IS NOT NULL AND org_role_id IS NULL) OR
    (member_type = 'role' AND org_role_id IS NOT NULL AND user_id IS NULL)
  ),
  UNIQUE (group_id, user_id),
  UNIQUE (group_id, org_role_id)
);

-- Add public_group sharing to record_shares
ALTER TABLE record_shares
  ADD COLUMN IF NOT EXISTS shared_with_group UUID
    REFERENCES public_groups(id) ON DELETE CASCADE;

CREATE INDEX idx_pg_id         ON public_groups(id);
CREATE INDEX idx_pgm_group_id  ON public_group_members(group_id);
CREATE INDEX idx_pgm_user_id   ON public_group_members(user_id);
CREATE INDEX idx_pgm_role_id   ON public_group_members(org_role_id);

ALTER TABLE public_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_group_members ENABLE ROW LEVEL SECURITY;

-- Function: check if user is a member of any group that has access to a record
CREATE OR REPLACE FUNCTION check_group_access(
  p_user_id   UUID,
  p_sf_object TEXT,
  p_record_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
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



alter table public.users
add column if not exists profile_image text;









-- Add is_admin_profile flag to profiles table
-- System Administrator profile = can access admin panel
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_system_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Update get_portal_users to remove system role dependency
CREATE OR REPLACE FUNCTION get_portal_users()
RETURNS TABLE (
  id              UUID,
  email           TEXT,
  name            TEXT,
  role            TEXT,     -- keep column but it becomes profile-driven
  is_active       BOOLEAN,
  must_change_pw  BOOLEAN,
  created_at      TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  profile_id      UUID,
  profile_name    TEXT,
  is_system_admin BOOLEAN,
  org_role_id     UUID,
  org_role_name   TEXT,
  org_role_level  INT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    u.id,
    u.email,
    u.name,
    u.role,
    u.is_active,
    u.must_change_pw,
    u.created_at,
    u.last_login_at,
    p.id            AS profile_id,
    p.name          AS profile_name,
    COALESCE(p.is_system_admin, FALSE) AS is_system_admin,
    r.id            AS org_role_id,
    r.name          AS org_role_name,
    r.level         AS org_role_level
  FROM users u
  LEFT JOIN user_profile_assignments upa ON upa.user_id = u.id
  LEFT JOIN profiles p ON p.id = upa.profile_id
  LEFT JOIN org_roles r ON r.id = u.org_role_id
  ORDER BY u.created_at DESC;
$$;


-- Mark the System Administrator profile
UPDATE profiles
SET is_system_admin = TRUE
WHERE name = 'System Administrator';





SELECT
  u.name,
  u.email,
  p.name  AS profile,
  r.name  AS org_role,
  r.level AS role_level
FROM users u
LEFT JOIN user_profile_assignments upa ON upa.user_id = u.id
LEFT JOIN profiles p  ON p.id  = upa.profile_id
LEFT JOIN org_roles r ON r.id  = u.org_role_id
ORDER BY r.level NULLS LAST, u.name;


-- ============================================================================
-- Role hierarchy tree compatibility patch
-- Run this in Supabase if Role Hierarchy does not show parent/child tree data.
-- Collapsed/expanded state is UI-only and does not need a database column.
-- ============================================================================

ALTER TABLE public.org_roles
  ADD COLUMN IF NOT EXISTS api_name TEXT,
  ADD COLUMN IF NOT EXISTS report_name TEXT,
  ADD COLUMN IF NOT EXISTS opportunity_access TEXT NOT NULL DEFAULT 'edit',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_org_roles_parent_id ON public.org_roles(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_roles_path ON public.org_roles(path);
CREATE INDEX IF NOT EXISTS idx_org_roles_level ON public.org_roles(level);

CREATE OR REPLACE FUNCTION public.get_org_role_tree()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
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
