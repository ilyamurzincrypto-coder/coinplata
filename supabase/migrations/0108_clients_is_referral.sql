-- clients.is_referral — настоящий boolean признак реферала
-- (вместо хака с [referral] в note). Без потери совместимости: backfill
-- из существующих note-меток.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_referral boolean NOT NULL DEFAULT false;

UPDATE public.clients
   SET is_referral = true
 WHERE (note ILIKE '%[referral]%' OR LOWER(COALESCE(tag, '')) = 'referral')
   AND is_referral = false;

CREATE INDEX IF NOT EXISTS clients_is_referral_idx
  ON public.clients (is_referral)
  WHERE is_referral = true;
