CREATE OR REPLACE FUNCTION public.clear_related_notifications(
  p_conversation_id uuid DEFAULT NULL,
  p_order_id bigint DEFAULT NULL,
  p_variant_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications AS n
  SET resolved_at = COALESCE(n.resolved_at, now()),
      read_at = COALESCE(n.read_at, now())
  WHERE n.resolved_at IS NULL
    AND (
      (p_conversation_id IS NOT NULL AND n.conversation_id = p_conversation_id)
      OR (p_order_id IS NOT NULL AND n.order_id = p_order_id)
      OR (p_variant_id IS NOT NULL AND n.type = 'low_stock'
        AND n.dedupe_key LIKE 'low_stock:' || p_variant_id::text || ':%')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.clear_related_notifications(uuid, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_related_notifications(uuid, bigint, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.clear_notifications_after_seller_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender = 'seller' THEN
    PERFORM public.clear_related_notifications(p_conversation_id => NEW.conversation_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_clear_seller_notifications
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.clear_notifications_after_seller_reply();

CREATE OR REPLACE FUNCTION public.clear_notifications_after_conversation_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.clear_related_notifications(p_conversation_id => NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversations_clear_resolved_notifications
AFTER UPDATE OF status ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.clear_notifications_after_conversation_resolved();

CREATE OR REPLACE FUNCTION public.clear_notifications_after_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('paid', 'shipped') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.clear_related_notifications(p_order_id => NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_clear_paid_notifications
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.clear_notifications_after_order_status();

CREATE OR REPLACE FUNCTION public.track_variant_notification_crossings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold integer;
  v_product_name text;
  v_notification_id uuid;
  v_dedupe_key text;
BEGIN
  IF NEW.stock = OLD.stock THEN RETURN NEW; END IF;

  SELECT low_stock_threshold INTO v_threshold
  FROM public.notification_settings
  WHERE shop_id = '00000000-0000-4000-8000-000000000001';
  v_threshold := COALESCE(v_threshold, 3);

  IF OLD.stock > v_threshold AND NEW.stock <= v_threshold THEN
    SELECT p.name INTO v_product_name
    FROM public.products p WHERE p.id = NEW.product_id;
    v_dedupe_key := 'low_stock:' || NEW.id::text || ':' || txid_current()::text;
    SELECT notification_id INTO v_notification_id
    FROM public.upsert_notification(
      'low_stock', 'info',
      'Low stock: ' || COALESCE(v_product_name, 'Product') || ' ' || NEW.size || ' has ' || NEW.stock || ' left',
      'Check the catalog stock.', '/catalog', NULL, NULL, v_dedupe_key, 0
    );
    INSERT INTO public.notification_deliveries (notification_id, channel, status)
    VALUES (v_notification_id, 'bell', 'sent');
  ELSIF OLD.stock <= v_threshold AND NEW.stock > v_threshold THEN
    PERFORM public.clear_related_notifications(p_variant_id => NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER variants_track_notification_crossings
AFTER UPDATE OF stock ON public.variants
FOR EACH ROW EXECUTE FUNCTION public.track_variant_notification_crossings();

CREATE OR REPLACE FUNCTION public.create_window_closing_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
  v_key text;
  v_notification_id uuid;
  v_created integer := 0;
BEGIN
  FOR v_record IN
    SELECT c.id, c.last_customer_message_at, cu.name
    FROM public.conversations c
    JOIN public.customers cu ON cu.id = c.customer_id
    WHERE cu.channel = 'messenger'
      AND c.last_customer_message_at > now() - interval '24 hours'
      AND c.last_customer_message_at <= now() - interval '22 hours'
      AND (
        c.status = 'needs_seller'
        OR NOT EXISTS (
          SELECT 1 FROM public.messages reply
          WHERE reply.conversation_id = c.id
            AND reply.sender IN ('seller', 'ai')
            AND reply.created_at > c.last_customer_message_at
        )
      )
  LOOP
    v_key := 'window_closing:' || v_record.id::text || ':' || to_char(v_record.last_customer_message_at, 'YYYYMMDDHH24MISS');
    PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
    IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.dedupe_key = v_key) THEN
      SELECT notification_id INTO v_notification_id
      FROM public.upsert_notification(
        'window_closing', 'attention',
        'Messenger window closes in 2 hours for ' || COALESCE(NULLIF(v_record.name, ''), 'customer'),
        'Reply before the messaging window closes.',
        '/inbox?conversation=' || v_record.id::text,
        v_record.id, NULL, v_key, 0
      );
      INSERT INTO public.notification_deliveries (notification_id, channel, status)
      VALUES (v_notification_id, 'bell', 'sent');
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.create_window_closing_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_window_closing_notifications() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'tindabot-window-closing-notifications',
  '*/15 * * * *',
  'SELECT public.create_window_closing_notifications()'
);
