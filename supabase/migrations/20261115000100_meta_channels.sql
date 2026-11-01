ALTER TABLE public.messages
  ADD COLUMN external_message_id text UNIQUE,
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'sent'
    CHECK (delivery_status IN ('sent', 'failed')),
  ADD COLUMN failure_reason text;

ALTER TABLE public.conversations
  ADD COLUMN last_customer_message_at timestamptz;

CREATE TABLE public.meta_webhook_messages (
  external_message_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_webhook_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_webhook_messages FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.claim_meta_webhook_message(p_external_message_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_external_message_id IS NULL OR p_external_message_id = '' THEN RETURN false; END IF;
  INSERT INTO public.meta_webhook_messages (external_message_id)
  VALUES (p_external_message_id) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_meta_webhook_message(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meta_webhook_message(text) TO service_role;

