CREATE OR REPLACE FUNCTION public.confirm_pending_order(
  p_conversation_id uuid,
  p_variant_id uuid,
  p_qty integer,
  p_unit_price numeric,
  p_line_total numeric,
  p_shipping numeric,
  p_offer_label text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_order_id bigint;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 OR p_unit_price IS NULL OR p_unit_price < 0
    OR p_line_total IS NULL OR p_line_total < 0 OR p_shipping IS NULL OR p_shipping < 0 THEN
    RETURN NULL;
  END IF;

  SELECT customer_id INTO v_customer_id
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;
  IF v_customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT public.reserve_stock(p_variant_id, p_qty) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.orders (conversation_id, customer_id, total, shipping)
  VALUES (p_conversation_id, v_customer_id, round(p_line_total, 2) + p_shipping, p_shipping)
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, variant_id, qty, unit_price, offer_label)
  VALUES (v_order_id, p_variant_id, p_qty, p_unit_price, p_offer_label);

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_pending_order(uuid, uuid, integer, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_pending_order(uuid, uuid, integer, numeric, numeric, numeric, text) TO service_role;
