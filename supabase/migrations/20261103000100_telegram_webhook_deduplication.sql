CREATE TABLE public.telegram_updates (
  update_id bigint PRIMARY KEY,
  state text NOT NULL DEFAULT 'processing'
    CHECK (state IN ('processing', 'processed', 'failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.telegram_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_updates FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.claim_telegram_update(p_update_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_id bigint;
BEGIN
  IF p_update_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.telegram_updates (update_id)
  VALUES (p_update_id)
  ON CONFLICT (update_id) DO NOTHING
  RETURNING update_id INTO claimed_id;

  RETURN claimed_id IS NOT NULL;
END;
$$;

CREATE FUNCTION public.complete_telegram_update(p_update_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.telegram_updates
  SET state = 'processed', completed_at = now()
  WHERE update_id = p_update_id AND state = 'processing';
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.fail_telegram_update(p_update_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.telegram_updates
  SET state = 'failed'
  WHERE update_id = p_update_id AND state = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_update(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_telegram_update(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_telegram_update(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_update(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_telegram_update(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_telegram_update(bigint) TO service_role;
