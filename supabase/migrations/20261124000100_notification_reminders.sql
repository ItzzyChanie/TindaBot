CREATE OR REPLACE FUNCTION public.claim_notification_reminders(p_limit integer DEFAULT 50)
RETURNS TABLE (
  notification_id uuid,
  type text,
  conversation_id uuid,
  order_id bigint,
  created_at timestamptz,
  customer_name text,
  channel text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT n.id
    FROM public.notifications AS n
    CROSS JOIN public.notification_settings AS s
    WHERE n.shop_id = s.shop_id
      AND n.shop_id = '00000000-0000-4000-8000-000000000001'
      AND n.type IN ('needs_seller', 'payment_proof')
      AND n.resolved_at IS NULL
      AND n.reminders_sent < 2
      AND (
        (s.bell_enabled AND COALESCE((s.event_prefs -> n.type ->> 'bell')::boolean, true))
        OR (s.telegram_enabled AND s.telegram_chat_id IS NOT NULL
          AND COALESCE((s.event_prefs -> n.type ->> 'telegram')::boolean, true))
      )
      AND n.created_at <= now() - make_interval(mins => s.reminder_after_minutes * (n.reminders_sent + 1))
    ORDER BY n.created_at, n.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    FOR UPDATE OF n SKIP LOCKED
  ), claimed AS (
    UPDATE public.notifications AS n
    SET reminders_sent = n.reminders_sent + 1
    FROM candidates AS c
    WHERE n.id = c.id AND n.resolved_at IS NULL AND n.reminders_sent < 2
    RETURNING n.id, n.type, n.conversation_id, n.order_id, n.created_at
  )
  SELECT claimed.id, claimed.type, claimed.conversation_id, claimed.order_id,
    claimed.created_at, cu.name, cu.channel
  FROM claimed
  LEFT JOIN public.conversations AS conv ON conv.id = claimed.conversation_id
  LEFT JOIN public.customers AS cu ON cu.id = conv.customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_reminders(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_reminders(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_notification_reminders()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_url text;
  v_scheduler_secret text;
  v_request_id bigint;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;

  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
    INTO v_project_url USING 'project_url';
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
    INTO v_scheduler_secret USING 'notification_scheduler_secret';
  IF COALESCE(v_project_url, '') = '' OR COALESCE(v_scheduler_secret, '') = '' THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/notification-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-scheduler-secret', v_scheduler_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_notification_reminders() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'tindabot-notification-reminders',
  '*/5 * * * *',
  'SELECT public.invoke_notification_reminders()'
);
