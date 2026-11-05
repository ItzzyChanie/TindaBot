CREATE OR REPLACE FUNCTION public.purge_expired_chat_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
  affected_count integer;
  cutoff timestamptz := now() - interval '90 days';
BEGIN
  WITH expired_reservations AS (
    SELECT oi.variant_id, sum(oi.qty)::integer AS qty
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.conversations c ON c.id = o.conversation_id
    WHERE o.status = 'awaiting_payment'
      AND c.last_message_at < cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.conversation_id = c.id AND jsonb_array_length(m.attachments) > 0
      )
    GROUP BY oi.variant_id
  )
  UPDATE public.variants v
  SET stock = v.stock + expired_reservations.qty,
      reserved_stock = v.reserved_stock - expired_reservations.qty
  FROM expired_reservations
  WHERE v.id = expired_reservations.variant_id;

  DELETE FROM public.orders o
  USING public.conversations c
  WHERE o.conversation_id = c.id
    AND c.last_message_at < cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = c.id AND jsonb_array_length(m.attachments) > 0
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  DELETE FROM public.conversations c
  WHERE c.last_message_at < cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = c.id AND jsonb_array_length(m.attachments) > 0
    );
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  deleted_count := deleted_count + affected_count;

  DELETE FROM public.customers cu
  WHERE cu.created_at < cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.customer_id = cu.id
    );
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  deleted_count := deleted_count + affected_count;

  DELETE FROM public.widget_session_creation_limits
  WHERE window_started_at < now() - interval '1 day';

  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_expired_chat_data() TO service_role;
