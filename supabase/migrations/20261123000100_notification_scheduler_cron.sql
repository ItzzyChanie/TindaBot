-- The URL and scheduler secret are provisioned in Supabase Vault, never stored here.
-- Expected Vault names: project_url and notification_scheduler_secret.
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.invoke_notification_scheduler()
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
    url := rtrim(v_project_url, '/') || '/functions/v1/notification-scheduler',
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

REVOKE ALL ON FUNCTION public.invoke_notification_scheduler() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'tindabot-notification-scheduler',
  '*/15 * * * *',
  'SELECT public.invoke_notification_scheduler()'
);
