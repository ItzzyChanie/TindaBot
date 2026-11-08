ALTER TABLE public.orders
  ADD COLUMN hidden_at timestamptz;

CREATE INDEX orders_hidden_created_idx
  ON public.orders (created_at DESC)
  WHERE hidden_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_order_hidden(p_order_id bigint, p_hidden boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  IF p_hidden IS NULL THEN RETURN false; END IF;
  UPDATE public.orders
  SET hidden_at = CASE WHEN p_hidden THEN COALESCE(hidden_at, now()) ELSE NULL END
  WHERE id = p_order_id;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.set_order_hidden(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_hidden(bigint, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_order(p_order_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item record;
  deleted_rows integer;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_order.status = 'awaiting_payment' THEN
    FOR v_item IN
      SELECT variant_id, sum(qty)::integer AS qty
      FROM public.order_items
      WHERE order_id = p_order_id
      GROUP BY variant_id
    LOOP
      UPDATE public.variants
      SET stock = stock + v_item.qty,
          reserved_stock = reserved_stock - v_item.qty
      WHERE id = v_item.variant_id
        AND reserved_stock >= v_item.qty;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'RESERVED_STOCK_MISMATCH' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.orders WHERE id = p_order_id;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RETURN deleted_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_order(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_order(bigint) TO authenticated, service_role;
