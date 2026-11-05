CREATE OR REPLACE VIEW public.public_catalog
WITH (security_barrier = true)
AS
SELECT
  p.id,
  p.name,
  p.description,
  p.image_url,
  p.price,
  p.discount_type,
  p.discount_value,
  p.discount_starts,
  p.discount_ends,
  COALESCE(variants.sizes, '[]'::jsonb) AS sizes,
  COALESCE(promos.promos, '[]'::jsonb) AS promos,
  p.colors
FROM public.products AS p
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'size', v.size,
      'availability', CASE
        WHEN v.stock <= 0 THEN 'sold_out'
        WHEN v.stock <= 2 THEN 'low_stock'
        ELSE 'in_stock'
      END
    ) ORDER BY v.size
  ) AS sizes
  FROM public.variants AS v
  WHERE v.product_id = p.id
) AS variants ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', pr.label,
      'kind', pr.kind,
      'min_qty', pr.min_qty,
      'value', pr.value,
      'starts_at', pr.starts_at,
      'ends_at', pr.ends_at,
      'active', pr.active
    ) ORDER BY pr.min_qty, pr.label
  ) AS promos
  FROM public.promos AS pr
  WHERE pr.product_id = p.id AND pr.active = true
) AS promos ON true
WHERE p.active = true;

COMMENT ON VIEW public.public_catalog IS
  'Safe public storefront data for active products. Variant stock is represented only as sold_out, low_stock, or in_stock.';

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
    AND c.last_message_at < cutoff;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  DELETE FROM public.conversations
  WHERE last_message_at < cutoff;
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

REVOKE ALL ON FUNCTION public.purge_expired_chat_data() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'tindabot-purge-expired-chat-data',
  '17 18 * * *',
  'SELECT public.purge_expired_chat_data()'
);
