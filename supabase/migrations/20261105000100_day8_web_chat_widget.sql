CREATE TABLE public.widget_sessions (
  token text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_from_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  rate_window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0)
);

COMMENT ON COLUMN public.widget_sessions.token IS
  'SHA-256 digest of the bearer token; the raw token is returned to the widget once.';

CREATE TABLE public.widget_session_creation_limits (
  ip_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

ALTER TABLE public.widget_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_session_creation_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.widget_sessions, public.widget_session_creation_limits
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.widget_sessions, public.widget_session_creation_limits
  TO service_role;

CREATE FUNCTION public.consume_widget_session_creation(p_ip_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count integer;
BEGIN
  INSERT INTO public.widget_session_creation_limits (ip_hash, window_started_at, request_count)
  VALUES (p_ip_hash, now(), 1)
  ON CONFLICT (ip_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN widget_session_creation_limits.window_started_at < now() - interval '10 minutes'
      THEN now() ELSE widget_session_creation_limits.window_started_at END,
    request_count = CASE
      WHEN widget_session_creation_limits.window_started_at < now() - interval '10 minutes'
      THEN 1 ELSE widget_session_creation_limits.request_count + 1 END
  RETURNING request_count INTO current_count;
  RETURN current_count <= 5;
END;
$$;

CREATE FUNCTION public.consume_widget_request(p_token text, p_is_message boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_window timestamptz;
  current_requests integer;
  current_messages integer;
BEGIN
  UPDATE public.widget_sessions
  SET
    rate_window_started_at = CASE
      WHEN rate_window_started_at < now() - interval '1 minute' THEN now()
      ELSE rate_window_started_at END,
    request_count = CASE
      WHEN rate_window_started_at < now() - interval '1 minute' THEN 1
      ELSE request_count + 1 END,
    message_count = CASE
      WHEN rate_window_started_at < now() - interval '1 minute' THEN
        CASE WHEN p_is_message THEN 1 ELSE 0 END
      WHEN p_is_message THEN message_count + 1
      ELSE message_count END,
    last_seen = now()
  WHERE token = p_token
  RETURNING rate_window_started_at, request_count, message_count
  INTO current_window, current_requests, current_messages;

  IF NOT FOUND THEN RETURN false; END IF;
  RETURN current_requests <= 45 AND current_messages <= 8;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_widget_session_creation(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_widget_request(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_widget_session_creation(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_widget_request(text, boolean) TO service_role;
