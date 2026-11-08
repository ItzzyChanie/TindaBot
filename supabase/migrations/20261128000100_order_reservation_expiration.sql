ALTER TABLE public.orders
  ADD COLUMN expires_at timestamptz;

UPDATE public.orders
SET expires_at = created_at + interval '20 days';

ALTER TABLE public.orders
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '20 days'),
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.orders DROP CONSTRAINT orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('awaiting_payment', 'paid', 'shipped', 'expired'));

CREATE INDEX orders_expiration_idx ON public.orders (expires_at)
  WHERE status = 'awaiting_payment';

CREATE OR REPLACE FUNCTION public.release_expired_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released_count integer := 0;
  expected_count integer := 0;
BEGIN
  WITH expired_orders AS (
    UPDATE public.orders SET status = 'expired'
    WHERE status = 'awaiting_payment' AND expires_at <= now()
    RETURNING id
  ), expired_reservations AS (
    SELECT oi.variant_id, sum(oi.qty)::integer AS qty
    FROM public.order_items oi JOIN expired_orders eo ON eo.id = oi.order_id
    GROUP BY oi.variant_id
  ), updated_variants AS (
    UPDATE public.variants v
    SET stock = v.stock + er.qty, reserved_stock = v.reserved_stock - er.qty
    FROM expired_reservations er
    WHERE v.id = er.variant_id AND v.reserved_stock >= er.qty
    RETURNING v.id
  )
  SELECT (SELECT count(*)::integer FROM updated_variants),
         (SELECT count(*)::integer FROM expired_reservations)
  INTO released_count, expected_count;
  IF released_count <> expected_count THEN
    RAISE EXCEPTION 'RESERVED_STOCK_MISMATCH' USING ERRCODE = '22023';
  END IF;
  RETURN released_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_expired_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_reservations() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'tindabot-release-expired-reservations',
  '*/15 * * * *',
  'SELECT public.release_expired_reservations()'
);

CREATE OR REPLACE FUNCTION public.set_order_status(p_order_id bigint, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_order.status = 'awaiting_payment' AND v_order.expires_at <= now() THEN
    FOR v_item IN
      SELECT variant_id, sum(qty)::integer AS qty
      FROM public.order_items WHERE order_id = p_order_id GROUP BY variant_id
    LOOP
      UPDATE public.variants
      SET stock = stock + v_item.qty, reserved_stock = reserved_stock - v_item.qty
      WHERE id = v_item.variant_id AND reserved_stock >= v_item.qty;
      IF NOT FOUND THEN RAISE EXCEPTION 'RESERVED_STOCK_MISMATCH' USING ERRCODE = '22023'; END IF;
    END LOOP;
    UPDATE public.orders SET status = 'expired' WHERE id = p_order_id;
    RETURN false;
  END IF;
  IF v_order.status = p_status THEN RETURN true; END IF;
  IF NOT ((v_order.status = 'awaiting_payment' AND p_status = 'paid')
    OR (v_order.status = 'paid' AND p_status = 'shipped')) THEN
    RAISE EXCEPTION 'INVALID_ORDER_STATUS_TRANSITION' USING ERRCODE = '22023';
  END IF;
  IF v_order.status = 'awaiting_payment' AND p_status = 'paid' THEN
    FOR v_item IN
      SELECT variant_id, sum(qty)::integer AS qty
      FROM public.order_items WHERE order_id = p_order_id GROUP BY variant_id
    LOOP
      UPDATE public.variants SET reserved_stock = reserved_stock - v_item.qty
      WHERE id = v_item.variant_id AND reserved_stock >= v_item.qty;
      IF NOT FOUND THEN RAISE EXCEPTION 'RESERVED_STOCK_MISMATCH' USING ERRCODE = '22023'; END IF;
    END LOOP;
  END IF;
  UPDATE public.orders SET status = p_status WHERE id = p_order_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_chat_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer := 0;
  affected_count integer;
  cutoff timestamptz := now() - interval '90 days';
BEGIN
  WITH expired_orders AS (
    UPDATE public.orders SET status = 'expired'
    WHERE status = 'awaiting_payment' AND expires_at <= now()
    RETURNING id
  ), expired_reservations AS (
    SELECT oi.variant_id, sum(oi.qty)::integer AS qty
    FROM public.order_items oi JOIN expired_orders eo ON eo.id = oi.order_id
    GROUP BY oi.variant_id
  )
  UPDATE public.variants v
  SET stock = v.stock + expired_reservations.qty,
      reserved_stock = v.reserved_stock - expired_reservations.qty
  FROM expired_reservations
  WHERE v.id = expired_reservations.variant_id
    AND v.reserved_stock >= expired_reservations.qty;

  WITH expired_reservations AS (
    SELECT oi.variant_id, sum(oi.qty)::integer AS qty
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.conversations c ON c.id = o.conversation_id
    WHERE o.status = 'awaiting_payment' AND c.last_message_at < cutoff
      AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id AND jsonb_array_length(m.attachments) > 0)
    GROUP BY oi.variant_id
  )
  UPDATE public.variants v
  SET stock = v.stock + expired_reservations.qty,
      reserved_stock = v.reserved_stock - expired_reservations.qty
  FROM expired_reservations WHERE v.id = expired_reservations.variant_id;

  DELETE FROM public.orders o USING public.conversations c
  WHERE o.conversation_id = c.id AND c.last_message_at < cutoff
    AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id AND jsonb_array_length(m.attachments) > 0);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  DELETE FROM public.conversations c WHERE c.last_message_at < cutoff
    AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id AND jsonb_array_length(m.attachments) > 0);
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  deleted_count := deleted_count + affected_count;
  DELETE FROM public.customers cu WHERE cu.created_at < cutoff
    AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.customer_id = cu.id);
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  deleted_count := deleted_count + affected_count;
  DELETE FROM public.widget_session_creation_limits WHERE window_started_at < now() - interval '1 day';
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_expired_chat_data() TO service_role;
