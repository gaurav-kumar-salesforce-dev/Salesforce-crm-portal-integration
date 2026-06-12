-- Salesforce-style sharing rule targets.
-- Keeps the older text-role columns for compatibility, but adds org role and
-- public group targets used by the CRM record visibility evaluator.

ALTER TABLE public.sharing_rules
  ADD COLUMN IF NOT EXISTS owner_org_role_id UUID REFERENCES public.org_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shared_with_org_role_id UUID REFERENCES public.org_roles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS shared_with_group_id UUID REFERENCES public.public_groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS shared_with_type TEXT DEFAULT 'role' NOT NULL;

ALTER TABLE public.sharing_rules
  DROP CONSTRAINT IF EXISTS sharing_rules_shared_with_type_check;

ALTER TABLE public.sharing_rules
  ADD CONSTRAINT sharing_rules_shared_with_type_check
  CHECK (shared_with_type IN ('role', 'public_group'));

ALTER TABLE public.record_shares
  ALTER COLUMN shared_with DROP NOT NULL;

ALTER TABLE public.record_shares
  DROP CONSTRAINT IF EXISTS record_shares_target_check;

ALTER TABLE public.record_shares
  ADD CONSTRAINT record_shares_target_check
  CHECK (
    (shared_with IS NOT NULL AND shared_with_group IS NULL)
    OR
    (shared_with IS NULL AND shared_with_group IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_sr_owner_org_role
  ON public.sharing_rules(owner_org_role_id);

CREATE INDEX IF NOT EXISTS idx_sr_shared_org_role
  ON public.sharing_rules(shared_with_org_role_id);

CREATE INDEX IF NOT EXISTS idx_sr_shared_group
  ON public.sharing_rules(shared_with_group_id);

CREATE INDEX IF NOT EXISTS idx_rs_shared_group
  ON public.record_shares(shared_with_group);
