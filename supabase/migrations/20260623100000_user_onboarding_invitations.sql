-- ============================================================================
-- User Onboarding Invitations
-- ============================================================================
-- Supports one-use account setup links for newly created portal users and
-- resend invitation from User Management. Raw tokens are never stored.

ALTER TABLE public.password_reset_tokens
  ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'password_reset',
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

UPDATE public.password_reset_tokens
SET token_type = 'password_reset'
WHERE token_type IS NULL;

ALTER TABLE public.password_reset_tokens
  DROP CONSTRAINT IF EXISTS password_reset_tokens_token_type_check;

ALTER TABLE public.password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_token_type_check
  CHECK (token_type IN ('password_reset', 'user_invitation'));

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_type_active
  ON public.password_reset_tokens(user_id, token_type)
  WHERE used = false AND revoked_at IS NULL;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;
