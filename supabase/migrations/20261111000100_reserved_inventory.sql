ALTER TABLE public.variants
  ADD COLUMN IF NOT EXISTS reserved_stock integer NOT NULL DEFAULT 0
  CHECK (reserved_stock >= 0);

UPDATE public.variants AS v
SET reserved_stock = COALESCE((
  SELECT sum(oi.qty)::integer
  FROM public.order_items AS oi
  JOIN public.orders AS o ON o.id = oi.order_id
  WHERE oi.variant_id = v.id AND o.status = 'awaiting_payment'
), 0);

CREATE OR REPLACE FUNCTION public.reserve_stock(p_variant uuid, p_qty integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN false; END IF;
  UPDATE public.variants
  SET stock = stock - p_qty,
      reserved_stock = reserved_stock + p_qty
  WHERE id = p_variant AND stock >= p_qty;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_stock(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid, integer) TO authenticated, service_role;

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
  COALESCE(promos.promos, '[]'::jsonb) AS promos
FROM public.products AS p
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'size', v.size,
      'availability', CASE
        WHEN v.stock <= 0 THEN 'sold_out'
        WHEN v.stock <= 2 THEN 'low_stock'
        ELSE 'in_stock'
      END,
      'reserved_stock', v.reserved_stock
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
  'Safe public storefront data. Availability labels do not expose on-hand stock counts; reserved_stock exposes only the quantity currently reserved per size.';

CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id bigint,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_item record;
BEGIN
  SELECT status INTO v_current_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN RETURN false; END IF;
  IF v_current_status = p_status THEN RETURN true; END IF;
  IF NOT ((v_current_status = 'awaiting_payment' AND p_status = 'paid')
    OR (v_current_status = 'paid' AND p_status = 'shipped')) THEN
    RAISE EXCEPTION 'INVALID_ORDER_STATUS_TRANSITION' USING ERRCODE = '22023';
  END IF;

  IF v_current_status = 'awaiting_payment' AND p_status = 'paid' THEN
    FOR v_item IN
      SELECT variant_id, sum(qty)::integer AS qty
      FROM public.order_items
      WHERE order_id = p_order_id
      GROUP BY variant_id
    LOOP
      UPDATE public.variants
      SET reserved_stock = reserved_stock - v_item.qty
      WHERE id = v_item.variant_id AND reserved_stock >= v_item.qty;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'RESERVED_STOCK_MISMATCH' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders SET status = p_status WHERE id = p_order_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_order_status(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_status(bigint, text) TO authenticated, service_role;
