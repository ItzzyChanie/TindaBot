CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'attention', 'urgent')),
  title text NOT NULL,
  body text NOT NULL,
  link text,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  order_id bigint REFERENCES public.orders(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL,
  group_count integer NOT NULL DEFAULT 1 CHECK (group_count > 0),
  reminders_sent integer NOT NULL DEFAULT 0 CHECK (reminders_sent >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  resolved_at timestamptz
);

CREATE INDEX notifications_shop_created_idx
  ON public.notifications (shop_id, created_at DESC);
CREATE INDEX notifications_unresolved_dedupe_idx
  ON public.notifications (shop_id, dedupe_key, last_event_at DESC)
  WHERE resolved_at IS NULL;

CREATE TABLE public.notification_settings (
  shop_id uuid PRIMARY KEY DEFAULT '00000000-0000-4000-8000-000000000001',
  bell_enabled boolean NOT NULL DEFAULT true,
  telegram_enabled boolean NOT NULL DEFAULT false,
  telegram_chat_id text,
  preview_customer_text boolean NOT NULL DEFAULT false,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_start time NOT NULL DEFAULT '22:00',
  quiet_end time NOT NULL DEFAULT '08:00',
  timezone text NOT NULL DEFAULT 'Asia/Manila',
  event_prefs jsonb NOT NULL DEFAULT '{
    "needs_seller": {"bell": true, "telegram": true},
    "new_order": {"bell": true, "telegram": true},
    "low_stock": {"bell": true, "telegram": true},
    "out_of_stock": {"bell": true, "telegram": true},
    "payment_proof": {"bell": true, "telegram": true},
    "delivery_failed": {"bell": true, "telegram": true},
    "window_closing": {"bell": true, "telegram": true}
  }'::jsonb,
  low_stock_threshold integer NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
  reminder_after_minutes integer NOT NULL DEFAULT 15 CHECK (reminder_after_minutes >= 0),
  group_window_minutes integer NOT NULL DEFAULT 5 CHECK (group_window_minutes >= 0)
);

INSERT INTO public.notification_settings (shop_id)
VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT (shop_id) DO NOTHING;

CREATE TABLE public.telegram_link_codes (
  code_hash text PRIMARY KEY,
  shop_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE TABLE public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('bell', 'telegram')),
  status text NOT NULL CHECK (status IN ('sent', 'suppressed_quiet_hours', 'suppressed_prefs', 'rate_limited', 'failed')),
  error_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_deliveries_notification_idx
  ON public.notification_deliveries (notification_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_seller_select ON public.notifications
  FOR SELECT TO authenticated USING (shop_id = '00000000-0000-4000-8000-000000000001');
CREATE POLICY notifications_seller_update ON public.notifications
  FOR UPDATE TO authenticated USING (shop_id = '00000000-0000-4000-8000-000000000001')
  WITH CHECK (shop_id = '00000000-0000-4000-8000-000000000001');
CREATE POLICY notification_settings_seller_select ON public.notification_settings
  FOR SELECT TO authenticated USING (shop_id = '00000000-0000-4000-8000-000000000001');
CREATE POLICY notification_settings_seller_update ON public.notification_settings
  FOR UPDATE TO authenticated USING (shop_id = '00000000-0000-4000-8000-000000000001')
  WITH CHECK (shop_id = '00000000-0000-4000-8000-000000000001');

GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at, resolved_at) ON public.notifications TO authenticated;
GRANT SELECT ON public.notification_settings TO authenticated;
GRANT UPDATE (bell_enabled, telegram_enabled, telegram_chat_id, preview_customer_text,
  quiet_hours_enabled, quiet_start, quiet_end, timezone, event_prefs,
  low_stock_threshold, reminder_after_minutes, group_window_minutes)
  ON public.notification_settings TO authenticated;
REVOKE ALL ON public.notifications, public.notification_settings,
  public.telegram_link_codes, public.notification_deliveries FROM anon;
REVOKE ALL ON public.telegram_link_codes, public.notification_deliveries FROM authenticated;
GRANT ALL ON public.notifications, public.notification_settings,
  public.telegram_link_codes, public.notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_notification(
  p_type text,
  p_severity text,
  p_title text,
  p_body text,
  p_link text,
  p_conversation_id uuid,
  p_order_id bigint,
  p_dedupe_key text,
  p_group_window_minutes integer
)
RETURNS TABLE (notification_id uuid, is_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Serialize concurrent events for a key so they cannot create duplicate groups.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_dedupe_key, 0));

  SELECT n.id INTO v_id
  FROM public.notifications AS n
  WHERE n.shop_id = '00000000-0000-4000-8000-000000000001'
    AND n.dedupe_key = p_dedupe_key
    AND n.resolved_at IS NULL
    AND n.last_event_at >= now() - make_interval(mins => GREATEST(p_group_window_minutes, 0))
  ORDER BY n.last_event_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NOT NULL THEN
    UPDATE public.notifications AS n
    SET group_count = n.group_count + 1,
        body = p_body,
        last_event_at = now()
    WHERE n.id = v_id;
    RETURN QUERY SELECT v_id, false;
  ELSE
    INSERT INTO public.notifications (
      type, severity, title, body, link, conversation_id, order_id, dedupe_key
    ) VALUES (
      p_type, p_severity, p_title, p_body, p_link, p_conversation_id, p_order_id, p_dedupe_key
    ) RETURNING id INTO v_id;
    RETURN QUERY SELECT v_id, true;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_notification(text, text, text, text, text, uuid, bigint, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification(text, text, text, text, text, uuid, bigint, text, integer)
  TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = 'notifications'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;
