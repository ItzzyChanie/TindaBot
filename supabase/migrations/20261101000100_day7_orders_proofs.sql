ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_proof jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.create_order(
  p_conversation_id uuid,
  p_items jsonb,
  p_shipping numeric,
  p_total numeric
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_order_id bigint;
  v_item jsonb;
  v_variant_id uuid;
  v_qty integer;
  v_unit_price numeric;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0
    OR p_shipping IS NULL OR p_shipping < 0 OR p_total IS NULL OR p_total < p_shipping THEN
    RAISE EXCEPTION 'INVALID_ORDER' USING ERRCODE = '22023';
  END IF;

  SELECT c.customer_id INTO v_customer_id
  FROM public.conversations AS c
  WHERE c.id = p_conversation_id
  FOR UPDATE;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_variant_id := (v_item->>'variant_id')::uuid;
      v_qty := (v_item->>'qty')::integer;
      v_unit_price := (v_item->>'unit_price')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'INVALID_ORDER_ITEM' USING ERRCODE = '22023';
    END;
    IF v_qty IS NULL OR v_qty <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'INVALID_ORDER_ITEM' USING ERRCODE = '22023';
    END IF;
    IF NOT public.reserve_stock(v_variant_id, v_qty) THEN
      RAISE EXCEPTION 'OUT_OF_STOCK' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO public.orders (conversation_id, customer_id, total, shipping)
  VALUES (p_conversation_id, v_customer_id, p_total, p_shipping)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (order_id, variant_id, qty, unit_price, offer_label)
    VALUES (
      v_order_id,
      (v_item->>'variant_id')::uuid,
      (v_item->>'qty')::integer,
      (v_item->>'unit_price')::numeric,
      NULLIF(v_item->>'offer_label', '')
    );
  END LOOP;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order(uuid, jsonb, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, jsonb, numeric, numeric) TO service_role;
