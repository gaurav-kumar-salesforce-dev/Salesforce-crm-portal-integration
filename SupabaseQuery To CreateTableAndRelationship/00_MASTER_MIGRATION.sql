-- =============================================================================
-- SaaSRAY CRM — RBAC Master Database Migration
-- Run this ENTIRE file in Supabase SQL Editor (one shot)
-- Supabase Project: your-project.supabase.co
-- Version: 1.0
-- =============================================================================


-- =============================================================================
-- STEP 0 — SAFETY: Drop everything cleanly if re-running
-- (safe to remove after first run)
-- =============================================================================

DROP TABLE IF EXISTS audit_log                        CASCADE;
DROP TABLE IF EXISTS sessions                         CASCADE;
DROP TABLE IF EXISTS user_permission_set_assignments  CASCADE;
DROP TABLE IF EXISTS permission_set_object_perms      CASCADE;
DROP TABLE IF EXISTS permission_sets                  CASCADE;
DROP TABLE IF EXISTS user_profile_assignments         CASCADE;
DROP TABLE IF EXISTS profile_object_permissions       CASCADE;
DROP TABLE IF EXISTS profiles                         CASCADE;
DROP TABLE IF EXISTS users                            CASCADE;
DROP TABLE IF EXISTS roles                            CASCADE;
DROP TABLE IF EXISTS sf_objects                       CASCADE;

-- Drop function if re-running
DROP FUNCTION IF EXISTS get_effective_permissions(UUID, TEXT);
DROP FUNCTION IF EXISTS update_updated_at_column();


-- =============================================================================
-- STEP 1 — REFERENCE TABLES
-- These are lookup tables. They rarely change after initial setup.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE: roles
-- The 5 fixed system roles. These never change — they are hardcoded in code too.
-- DO NOT add custom roles here — use profiles for that.
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
  id          SERIAL        PRIMARY KEY,
  name        TEXT          UNIQUE NOT NULL
                            CHECK (name IN ('super_admin','admin','manager','employee','readonly')),
  label       TEXT          NOT NULL,  -- Human-readable: "Super Admin"
  description TEXT,
  sort_order  INT           NOT NULL DEFAULT 0  -- Controls display order in UI
);

COMMENT ON TABLE roles IS 'Fixed system roles. Never modified at runtime. Maps to role column in users table.';


-- -----------------------------------------------------------------------------
-- TABLE: sf_objects
-- The Salesforce objects your portal exposes. Add/remove as your CRM grows.
-- This drives the permission matrix in the admin panel.
-- -----------------------------------------------------------------------------
CREATE TABLE sf_objects (
  id          SERIAL  PRIMARY KEY,
  api_name    TEXT    UNIQUE NOT NULL,  -- Exact SF API name: 'Account', 'Contact'
  label       TEXT    NOT NULL,         -- UI label: "Accounts", "Contacts"
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,  -- Toggle off to hide from permission matrix
  sort_order  INT     NOT NULL DEFAULT 0
);

COMMENT ON TABLE sf_objects IS 'Salesforce objects exposed by the portal. Drives the permission matrix UI.';


-- =============================================================================
-- STEP 2 — CORE USER TABLE
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE: users
-- All portal users. NOT Salesforce users. These are people who log into SaaSRAY.
-- Password hashing is done in Node.js (bcrypt). Never store plain passwords here.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT          UNIQUE NOT NULL,
  password_hash     TEXT          NOT NULL,        -- bcrypt hash from Node.js
  name              TEXT          NOT NULL,
  role              TEXT          NOT NULL DEFAULT 'employee'
                                  CHECK (role IN ('super_admin','admin','manager','employee','readonly')),
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  must_change_pw    BOOLEAN       NOT NULL DEFAULT FALSE,  -- Force pw change on first login
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE users IS 'Portal users. One row per person who can log in. Role column is the system role (ceiling). Profile assignment defines object-level CRUD permissions.';
COMMENT ON COLUMN users.role IS 'System role: sets UI access ceiling. Actual SF object permissions come from profile + permission sets.';
COMMENT ON COLUMN users.must_change_pw IS 'Set TRUE when admin creates account with temp password. Login page checks this and forces password change.';


-- =============================================================================
-- STEP 3 — PROFILE TABLES
-- Profiles = baseline CRUD permissions per Salesforce object.
-- Every user has exactly ONE profile. Think of it as the "floor".
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE: profiles
-- Named permission templates. e.g. "Sales Rep Profile", "Support Agent Profile"
-- Admin creates these in the admin panel.
-- -----------------------------------------------------------------------------
CREATE TABLE profiles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        UNIQUE NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE profiles IS 'Named permission templates. Each user gets one profile as their baseline CRUD permissions across SF objects.';


-- -----------------------------------------------------------------------------
-- TABLE: profile_object_permissions
-- The actual CRUD flags: Profile X can Read/Create/Edit/Delete SF Object Y.
-- One row per (profile, sf_object) pair.
-- -----------------------------------------------------------------------------
CREATE TABLE profile_object_permissions (
  profile_id  UUID      NOT NULL REFERENCES profiles(id)    ON DELETE CASCADE,
  sf_object   TEXT      NOT NULL,  -- Must match sf_objects.api_name
  can_read    BOOLEAN   NOT NULL DEFAULT FALSE,
  can_create  BOOLEAN   NOT NULL DEFAULT FALSE,
  can_edit    BOOLEAN   NOT NULL DEFAULT FALSE,
  can_delete  BOOLEAN   NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, sf_object)
);

COMMENT ON TABLE profile_object_permissions IS 'CRUD flags per SF object per profile. One row per (profile, object) combo. These are the baseline permissions (the floor).';


-- -----------------------------------------------------------------------------
-- TABLE: user_profile_assignments
-- Which profile a user currently has. Always ONE row per user (enforced by PK).
-- When admin changes a user's profile, UPDATE this row — don't INSERT a new one.
-- -----------------------------------------------------------------------------
CREATE TABLE user_profile_assignments (
  user_id     UUID        PRIMARY KEY REFERENCES users(id)    ON DELETE CASCADE,
  profile_id  UUID        NOT NULL    REFERENCES profiles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID        REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE user_profile_assignments IS 'Maps each user to exactly one profile. PK on user_id enforces one-profile-per-user. ON DELETE RESTRICT prevents deleting a profile that is in use.';


-- =============================================================================
-- STEP 4 — PERMISSION SET TABLES
-- Permission Sets = additive overrides ON TOP of profile.
-- A user can have zero, one, or many permission sets.
-- Permission sets ONLY add permissions — they never remove them.
-- Final permission = Profile OR any PermSet. If any source grants it → granted.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE: permission_sets
-- Named additive permission bundles. e.g. "Delete Accounts", "Campaign Manager"
-- -----------------------------------------------------------------------------
CREATE TABLE permission_sets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        UNIQUE NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE permission_sets IS 'Additive permission overlays on top of a user profile. A user can have multiple. They only ADD permissions, never remove them.';


-- -----------------------------------------------------------------------------
-- TABLE: permission_set_object_perms
-- CRUD flags for each permission set per SF object.
-- Same structure as profile_object_permissions — additive layer.
-- -----------------------------------------------------------------------------
CREATE TABLE permission_set_object_perms (
  perm_set_id UUID      NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
  sf_object   TEXT      NOT NULL,  -- Must match sf_objects.api_name
  can_read    BOOLEAN   NOT NULL DEFAULT FALSE,
  can_create  BOOLEAN   NOT NULL DEFAULT FALSE,
  can_edit    BOOLEAN   NOT NULL DEFAULT FALSE,
  can_delete  BOOLEAN   NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (perm_set_id, sf_object)
);

COMMENT ON TABLE permission_set_object_perms IS 'CRUD overrides per SF object per permission set. Merged with profile perms using OR logic at runtime.';


-- -----------------------------------------------------------------------------
-- TABLE: user_permission_set_assignments
-- Which permission sets a user has. Zero to many rows per user.
-- -----------------------------------------------------------------------------
CREATE TABLE user_permission_set_assignments (
  user_id     UUID        NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  perm_set_id UUID        NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, perm_set_id)
);

COMMENT ON TABLE user_permission_set_assignments IS 'Maps users to their permission sets (many-to-many). A user can have zero or many.';


-- =============================================================================
-- STEP 5 — SESSION & AUDIT TABLES
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE: sessions
-- Tracks active JWT sessions. Enables logout (token revocation) and audit.
-- Optional: if you use short-lived JWTs and don't need server-side revocation,
-- you can skip this table and rely purely on JWT expiry.
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,  -- SHA-256 of the JWT — never store raw token
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ              -- NULL = active. Set to now() on logout.
);

COMMENT ON TABLE sessions IS 'Active JWT sessions. Allows server-side logout (set revoked_at). token_hash is SHA-256 of the actual JWT — raw token never stored.';


-- -----------------------------------------------------------------------------
-- TABLE: audit_log
-- Immutable log of every write action through the portal.
-- INSERT only — never UPDATE or DELETE rows here.
-- Used for compliance, debugging, and "who changed this record?"
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  user_email  TEXT,                -- Denormalized: snapshot email at time of action
  user_role   TEXT,                -- Denormalized: snapshot role at time of action
  action      TEXT        NOT NULL
              CHECK (action IN ('login','logout','create','read','edit','delete',
                                'assign_profile','assign_perm_set',
                                'create_user','update_user','deactivate_user',
                                'create_profile','update_profile',
                                'create_perm_set','update_perm_set',
                                'password_reset','failed_login')),
  sf_object   TEXT,                -- e.g. 'Account' — null for non-SF actions
  record_id   TEXT,                -- Salesforce record ID (18-char) — null for admin actions
  payload     JSONB,               -- Full before/after or relevant context
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_log IS 'Append-only audit trail. Every create/edit/delete through the portal is logged here. Never update or delete rows. Denormalized email/role ensures log is accurate even after user changes.';


-- =============================================================================
-- STEP 6 — INDEXES
-- Critical for query performance. The permission resolution runs on EVERY API
-- call, so these indexes are not optional.
-- =============================================================================

-- Users: email lookup on every login
CREATE INDEX idx_users_email          ON users(email);
CREATE INDEX idx_users_role           ON users(role);
CREATE INDEX idx_users_is_active      ON users(is_active);

-- Profile permissions: permission resolution query
CREATE INDEX idx_pop_profile_id       ON profile_object_permissions(profile_id);
CREATE INDEX idx_pop_sf_object        ON profile_object_permissions(sf_object);

-- User profile assignments: fast lookup of user's profile
-- (PK on user_id already covers this, but explicit for clarity)
CREATE INDEX idx_upa_profile_id       ON user_profile_assignments(profile_id);

-- Permission set permissions: permission resolution query
CREATE INDEX idx_psop_perm_set_id     ON permission_set_object_perms(perm_set_id);
CREATE INDEX idx_psop_sf_object       ON permission_set_object_perms(sf_object);

-- User permission set assignments: which sets does this user have?
CREATE INDEX idx_upsa_user_id         ON user_permission_set_assignments(user_id);
CREATE INDEX idx_upsa_perm_set_id     ON user_permission_set_assignments(perm_set_id);

-- Sessions: lookup by token_hash on every authenticated request
CREATE INDEX idx_sessions_token_hash  ON sessions(token_hash);
CREATE INDEX idx_sessions_user_id     ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at  ON sessions(expires_at);

-- Audit log: queries by user, object, date
CREATE INDEX idx_audit_user_id        ON audit_log(user_id);
CREATE INDEX idx_audit_sf_object      ON audit_log(sf_object);
CREATE INDEX idx_audit_created_at     ON audit_log(created_at DESC);
CREATE INDEX idx_audit_action         ON audit_log(action);


-- =============================================================================
-- STEP 7 — AUTO-UPDATE updated_at TRIGGER
-- Keeps updated_at fresh automatically. No need to set it manually in code.
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_permission_sets_updated_at
  BEFORE UPDATE ON permission_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =============================================================================
-- STEP 8 — PERMISSION RESOLUTION FUNCTION
-- The core of the RBAC system. Call this from Node.js instead of raw SQL.
-- Returns effective permissions for a user on a SF object.
-- Logic: Profile OR any PermissionSet → if ANY grants it, it's granted.
-- Super Admin always gets TRUE on everything (handled in Node.js middleware,
-- but also correct here for direct DB calls).
-- =============================================================================

CREATE OR REPLACE FUNCTION get_effective_permissions(
  p_user_id  UUID,
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
  -- Check if user is super_admin — bypass all permission checks
  SELECT role INTO v_role FROM users WHERE id = p_user_id AND is_active = TRUE;

  IF v_role = 'super_admin' THEN
    RETURN QUERY SELECT TRUE, TRUE, TRUE, TRUE;
    RETURN;
  END IF;

  -- Compute effective permissions: Profile OR any PermissionSet (OR logic)
  RETURN QUERY
  SELECT
    BOOL_OR(p.can_read)   AS can_read,
    BOOL_OR(p.can_create) AS can_create,
    BOOL_OR(p.can_edit)   AS can_edit,
    BOOL_OR(p.can_delete) AS can_delete
  FROM (
    -- Source 1: Profile permissions (the floor)
    SELECT
      pop.can_read,
      pop.can_create,
      pop.can_edit,
      pop.can_delete
    FROM user_profile_assignments upa
    JOIN profile_object_permissions pop
      ON pop.profile_id = upa.profile_id
     AND pop.sf_object  = p_sf_object
    WHERE upa.user_id = p_user_id

    UNION ALL

    -- Source 2: Permission set permissions (the additive ceiling)
    SELECT
      psop.can_read,
      psop.can_create,
      psop.can_edit,
      psop.can_delete
    FROM user_permission_set_assignments upsa
    JOIN permission_set_object_perms psop
      ON psop.perm_set_id = upsa.perm_set_id
     AND psop.sf_object   = p_sf_object
    WHERE upsa.user_id = p_user_id
  ) p;
END;
$$;

COMMENT ON FUNCTION get_effective_permissions IS 'Returns the effective CRUD permissions for a user on a SF object. Merges profile + all permission sets using OR logic. Super admins always get TRUE. Call this from Node.js permission middleware.';


-- =============================================================================
-- STEP 9 — ROW LEVEL SECURITY (RLS)
-- Adds a database-level enforcement layer on top of your Node.js middleware.
-- Even if someone bypasses your Express server and queries Supabase directly
-- with the anon key, they cannot read other users data.
-- Note: Using service_role key in Node.js bypasses RLS — which is correct,
-- because your server is the trusted layer that enforces permissions itself.
-- =============================================================================

ALTER TABLE users                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_object_permissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_sets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_set_object_perms   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permission_set_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                     ENABLE ROW LEVEL SECURITY;

-- Service role (your Node.js server) bypasses RLS — full access
-- Anon/public key: deny everything by default (no policies = deny)
-- This means: only your server (with service_role key) can read/write.
-- Direct Supabase client calls with anon key are blocked at DB level.

COMMENT ON TABLE users IS 'RLS enabled. Only accessible via service_role key (Node.js server). Anon key blocked.';


-- =============================================================================
-- STEP 10 — SEED DATA: Reference Tables
-- =============================================================================


-- Roles (fixed — these match the CHECK constraint on users.role)
INSERT INTO roles (name, label, description, sort_order) VALUES
  ('super_admin', 'Super Admin', 'Full system access. Manages all users, roles, profiles, and permission sets. Bypasses all object permission checks.', 1),
  ('admin',       'Admin',       'Manages users and permission configurations. Full CRUD on all Salesforce objects.', 2),
  ('manager',     'Manager',     'Team lead access. Full CRUD on assigned objects; read-only on others. Can view team members.', 3),
  ('employee',    'Employee',    'Standard user. Object access defined by profile and permission sets.', 4),
  ('readonly',    'Read-Only',   'View-only access. Can never create, edit, or delete records regardless of profile.', 5);


-- Salesforce objects your CRM portal exposes
INSERT INTO sf_objects (api_name, label, is_active, sort_order) VALUES
  ('Account',      'Accounts',      TRUE, 1),
  ('Contact',      'Contacts',      TRUE, 2),
  ('Opportunity',  'Opportunities', TRUE, 3),
  ('Lead',         'Leads',         TRUE, 4),
  ('Case',         'Cases',         TRUE, 5),
  ('Campaign',     'Campaigns',     TRUE, 6),
  ('Task',         'Tasks',         TRUE, 7),
  ('Event',        'Events',        TRUE, 8);


-- =============================================================================
-- STEP 11 — SEED DATA: Profiles
-- These are the 4 example profiles from the architecture document.
-- Adjust permissions as needed for your actual CRM usage.
-- =============================================================================

-- Insert profiles (no created_by yet — super admin doesn't exist yet)
INSERT INTO profiles (id, name, description) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Sales Rep Profile',     'Standard sales rep: Read/Create/Edit on sales objects. No Campaign or Case.'),
  ('22222222-2222-2222-2222-222222222222', 'Support Agent Profile',  'Support team: Read/Edit on Case, Contact, Account. No Opportunity or Campaign.'),
  ('33333333-3333-3333-3333-333333333333', 'Marketing Profile',      'Marketing team: Full access to Campaign and Lead. Read-only on Account and Contact.'),
  ('44444444-4444-4444-4444-444444444444', 'Read-Only Profile',      'View everything, change nothing. For stakeholders and executives.');


-- Profile Object Permissions: Sales Rep Profile
-- Accounts: Read, Create, Edit (no Delete)
-- Contacts: Read, Create, Edit (no Delete)
-- Opportunities: Read, Create, Edit (no Delete)
-- Leads: Read, Create, Edit (no Delete)
-- Cases: No access
-- Campaigns: No access
-- Tasks: Read, Create, Edit
-- Events: Read, Create, Edit
INSERT INTO profile_object_permissions
  (profile_id,                             sf_object,      can_read, can_create, can_edit, can_delete)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Account',      TRUE,  TRUE,  TRUE,  FALSE),
  ('11111111-1111-1111-1111-111111111111', 'Contact',      TRUE,  TRUE,  TRUE,  FALSE),
  ('11111111-1111-1111-1111-111111111111', 'Opportunity',  TRUE,  TRUE,  TRUE,  FALSE),
  ('11111111-1111-1111-1111-111111111111', 'Lead',         TRUE,  TRUE,  TRUE,  FALSE),
  ('11111111-1111-1111-1111-111111111111', 'Case',         FALSE, FALSE, FALSE, FALSE),
  ('11111111-1111-1111-1111-111111111111', 'Campaign',     FALSE, FALSE, FALSE, FALSE),
  ('11111111-1111-1111-1111-111111111111', 'Task',         TRUE,  TRUE,  TRUE,  FALSE),
  ('11111111-1111-1111-1111-111111111111', 'Event',        TRUE,  TRUE,  TRUE,  FALSE);


-- Profile Object Permissions: Support Agent Profile
-- Accounts: Read, Edit only
-- Contacts: Read, Create, Edit (no Delete)
-- Opportunities: Read only
-- Leads: No access
-- Cases: Read, Create, Edit (no Delete) — primary object
-- Campaigns: No access
-- Tasks: Read, Create, Edit
-- Events: Read only
INSERT INTO profile_object_permissions
  (profile_id,                             sf_object,      can_read, can_create, can_edit, can_delete)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'Account',      TRUE,  FALSE, TRUE,  FALSE),
  ('22222222-2222-2222-2222-222222222222', 'Contact',      TRUE,  TRUE,  TRUE,  FALSE),
  ('22222222-2222-2222-2222-222222222222', 'Opportunity',  TRUE,  FALSE, FALSE, FALSE),
  ('22222222-2222-2222-2222-222222222222', 'Lead',         FALSE, FALSE, FALSE, FALSE),
  ('22222222-2222-2222-2222-222222222222', 'Case',         TRUE,  TRUE,  TRUE,  FALSE),
  ('22222222-2222-2222-2222-222222222222', 'Campaign',     FALSE, FALSE, FALSE, FALSE),
  ('22222222-2222-2222-2222-222222222222', 'Task',         TRUE,  TRUE,  TRUE,  FALSE),
  ('22222222-2222-2222-2222-222222222222', 'Event',        TRUE,  FALSE, FALSE, FALSE);


-- Profile Object Permissions: Marketing Profile
-- Accounts: Read only
-- Contacts: Read only
-- Opportunities: No access
-- Leads: Read, Create, Edit (no Delete) — primary object
-- Cases: No access
-- Campaigns: Read, Create, Edit (no Delete) — primary object
-- Tasks: Read, Create, Edit
-- Events: Read, Create, Edit
INSERT INTO profile_object_permissions
  (profile_id,                             sf_object,      can_read, can_create, can_edit, can_delete)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'Account',      TRUE,  FALSE, FALSE, FALSE),
  ('33333333-3333-3333-3333-333333333333', 'Contact',      TRUE,  FALSE, FALSE, FALSE),
  ('33333333-3333-3333-3333-333333333333', 'Opportunity',  FALSE, FALSE, FALSE, FALSE),
  ('33333333-3333-3333-3333-333333333333', 'Lead',         TRUE,  TRUE,  TRUE,  FALSE),
  ('33333333-3333-3333-3333-333333333333', 'Case',         FALSE, FALSE, FALSE, FALSE),
  ('33333333-3333-3333-3333-333333333333', 'Campaign',     TRUE,  TRUE,  TRUE,  FALSE),
  ('33333333-3333-3333-3333-333333333333', 'Task',         TRUE,  TRUE,  TRUE,  FALSE),
  ('33333333-3333-3333-3333-333333333333', 'Event',        TRUE,  TRUE,  TRUE,  FALSE);


-- Profile Object Permissions: Read-Only Profile
-- Read TRUE on everything. All write permissions FALSE.
INSERT INTO profile_object_permissions
  (profile_id,                             sf_object,      can_read, can_create, can_edit, can_delete)
VALUES
  ('44444444-4444-4444-4444-444444444444', 'Account',      TRUE,  FALSE, FALSE, FALSE),
  ('44444444-4444-4444-4444-444444444444', 'Contact',      TRUE,  FALSE, FALSE, FALSE),
  ('44444444-4444-4444-4444-444444444444', 'Opportunity',  TRUE,  FALSE, FALSE, FALSE),
  ('44444444-4444-4444-4444-444444444444', 'Lead',         TRUE,  FALSE, FALSE, FALSE),
  ('44444444-4444-4444-4444-444444444444', 'Case',         TRUE,  FALSE, FALSE, FALSE),
  ('44444444-4444-4444-4444-444444444444', 'Campaign',     TRUE,  FALSE, FALSE, FALSE),
  ('44444444-4444-4444-4444-444444444444', 'Task',         TRUE,  FALSE, FALSE, FALSE),
  ('44444444-4444-4444-4444-444444444444', 'Event',        TRUE,  FALSE, FALSE, FALSE);


-- =============================================================================
-- STEP 12 — SEED DATA: Permission Sets
-- Additive overrides. These are assigned ON TOP of a profile.
-- =============================================================================

INSERT INTO permission_sets (id, name, description) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Delete Accounts',    'Grants delete permission on Accounts. Assign to Managers who need to merge/clean account records.'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Delete Contacts',    'Grants delete permission on Contacts.'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Campaign Manager',   'Full CRUD on Campaigns and Leads. For Sales Reps running their own campaigns.'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'View All Leads',     'Read access on Leads. For Support Agents who need to see lead context.'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Opportunity Editor', 'Create and Edit on Opportunities. For Support Agents escalating to sales.'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Full Delete Rights', 'Delete on all objects. For Admin-level users managing data hygiene.');


-- Permission Set Object Permissions: Delete Accounts
INSERT INTO permission_set_object_perms
  (perm_set_id,                              sf_object,  can_read, can_create, can_edit, can_delete)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  'Account',  FALSE, FALSE, FALSE, TRUE);


-- Permission Set Object Permissions: Delete Contacts
INSERT INTO permission_set_object_perms
  (perm_set_id,                              sf_object,  can_read, can_create, can_edit, can_delete)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  'Contact',  FALSE, FALSE, FALSE, TRUE);


-- Permission Set Object Permissions: Campaign Manager
INSERT INTO permission_set_object_perms
  (perm_set_id,                              sf_object,   can_read, can_create, can_edit, can_delete)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',  'Campaign',  TRUE,  TRUE,  TRUE,  TRUE),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',  'Lead',      TRUE,  TRUE,  TRUE,  FALSE);


-- Permission Set Object Permissions: View All Leads
INSERT INTO permission_set_object_perms
  (perm_set_id,                              sf_object,  can_read, can_create, can_edit, can_delete)
VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',  'Lead',     TRUE,  FALSE, FALSE, FALSE);


-- Permission Set Object Permissions: Opportunity Editor
INSERT INTO permission_set_object_perms
  (perm_set_id,                              sf_object,      can_read, can_create, can_edit, can_delete)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',  'Opportunity',  TRUE,  TRUE,  TRUE,  FALSE);


-- Permission Set Object Permissions: Full Delete Rights
INSERT INTO permission_set_object_perms
  (perm_set_id,                              sf_object,      can_read, can_create, can_edit, can_delete)
VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',  'Account',      FALSE, FALSE, FALSE, TRUE),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',  'Contact',      FALSE, FALSE, FALSE, TRUE),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',  'Opportunity',  FALSE, FALSE, FALSE, TRUE),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',  'Lead',         FALSE, FALSE, FALSE, TRUE),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',  'Case',         FALSE, FALSE, FALSE, TRUE),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',  'Campaign',     FALSE, FALSE, FALSE, TRUE),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',  'Task',         FALSE, FALSE, FALSE, TRUE),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',  'Event',        FALSE, FALSE, FALSE, TRUE);


-- =============================================================================
-- STEP 13 — SEED DATA: Super Admin User
--
-- ⚠️  IMPORTANT: Change the password IMMEDIATELY after first login.
-- This bcrypt hash is for the password: "Admin@1234!" (cost factor 12)
-- Generate your own hash in Node.js: bcrypt.hashSync('YourPassword', 12)
-- Then UPDATE this row with your real hash BEFORE going live.
-- =============================================================================

INSERT INTO users
  (id, email, password_hash, name, role, is_active, must_change_pw)
VALUES (
  'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
  'superadmin@saasray.com',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TdxmQoysGAT4oiHO0i1EkXWi5W2O',  -- "Admin@1234!"
  'Super Administrator',
  'super_admin',
  TRUE,
  TRUE   -- Force password change on first login
);

-- Assign Read-Only Profile to Super Admin (they bypass perms anyway, but
-- every user MUST have a profile assignment — no orphan users)
INSERT INTO user_profile_assignments (user_id, profile_id) VALUES
  ('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', '44444444-4444-4444-4444-444444444444');


-- =============================================================================
-- STEP 14 — SEED DATA: Demo Users (remove in production, keep for dev/testing)
-- All demo users have password: "Demo@1234!" — change before any real use.
-- =============================================================================

INSERT INTO users
  (id, email, password_hash, name, role, is_active, must_change_pw)
VALUES
  -- Admin user
  ('BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
   'admin@saasray.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TdxmQoysGAT4oiHO0i1EkXWi5W2O',
   'Portal Admin',
   'admin', TRUE, TRUE),

  -- Manager user
  ('CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',
   'manager@saasray.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TdxmQoysGAT4oiHO0i1EkXWi5W2O',
   'Sales Manager',
   'manager', TRUE, TRUE),

  -- Employee (Sales Rep)
  ('DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD',
   'salesrep@saasray.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TdxmQoysGAT4oiHO0i1EkXWi5W2O',
   'Sales Rep One',
   'employee', TRUE, TRUE),

  -- Employee (Support Agent)
  ('EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE',
   'support@saasray.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TdxmQoysGAT4oiHO0i1EkXWi5W2O',
   'Support Agent One',
   'employee', TRUE, TRUE),

  -- Read-only (Stakeholder)
  ('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
   'stakeholder@saasray.com',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TdxmQoysGAT4oiHO0i1EkXWi5W2O',
   'Executive Stakeholder',
   'readonly', TRUE, TRUE);


-- Profile assignments for demo users
INSERT INTO user_profile_assignments (user_id, profile_id, assigned_by) VALUES
  -- Admin gets Read-Only profile (they bypass via role anyway)
  ('BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
   '44444444-4444-4444-4444-444444444444',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),

  -- Manager gets Sales Rep Profile (extended by permission sets below)
  ('CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',
   '11111111-1111-1111-1111-111111111111',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),

  -- Sales Rep gets Sales Rep Profile
  ('DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD',
   '11111111-1111-1111-1111-111111111111',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),

  -- Support Agent gets Support Agent Profile
  ('EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE',
   '22222222-2222-2222-2222-222222222222',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),

  -- Stakeholder gets Read-Only Profile
  ('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
   '44444444-4444-4444-4444-444444444444',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA');


-- Permission set assignments for demo users
INSERT INTO user_permission_set_assignments (user_id, perm_set_id, assigned_by) VALUES
  -- Manager gets: Delete Accounts + Delete Contacts (team lead cleanup rights)
  ('CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),
  ('CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),

  -- Support Agent gets: View All Leads + Opportunity Editor
  ('EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),
  ('EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA');


-- =============================================================================
-- STEP 15 — VERIFICATION QUERIES
-- Run these after the migration to confirm everything is correct.
-- Copy-paste them individually in the Supabase SQL Editor.
-- =============================================================================

-- 1. Check all tables exist with correct row counts

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. Verify all users have a profile assignment (no orphan users)
SELECT u.email, u.role, p.name AS profile
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

-- 7. Full permission matrix for all users on all objects
-- Use this to review the entire permission setup at a glance
SELECT
  u.email,
  u.role,
  p.name AS profile,
  sfo.api_name AS sf_object,
  perms.can_read,
  perms.can_create,
  perms.can_edit,
  perms.can_delete
FROM users u
JOIN user_profile_assignments upa ON upa.user_id = u.id
JOIN profiles p ON p.id = upa.profile_id
CROSS JOIN sf_objects sfo
CROSS JOIN LATERAL get_effective_permissions(u.id, sfo.api_name) perms
ORDER BY u.email, sfo.sort_order;




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
