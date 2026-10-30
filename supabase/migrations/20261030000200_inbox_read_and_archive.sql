ALTER TABLE public.conversations
  ADD COLUMN seller_read_at timestamptz,
  ADD COLUMN is_hidden boolean NOT NULL DEFAULT false;

CREATE INDEX conversations_unread_seller_idx
  ON public.conversations (status, seller_read_at)
  WHERE status = 'needs_seller' AND is_hidden = false;
