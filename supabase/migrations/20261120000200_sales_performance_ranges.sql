CREATE INDEX IF NOT EXISTS orders_created_status_idx
  ON public.orders (created_at DESC, status);

CREATE OR REPLACE FUNCTION public.get_sales_performance(p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT GREATEST(p_start, DATE '2000-01-01') AS start_day,
      LEAST(p_end, timezone('Asia/Manila', now())::date) AS end_day
  ), bounds AS (
    SELECT start_day, end_day,
      (end_day - start_day + 1) AS span,
      (start_day - (end_day - start_day + 1)) AS previous_start
    FROM params
  ), paid AS (
    SELECT o.id, o.total, timezone('Asia/Manila', o.created_at)::date AS day
    FROM public.orders o, bounds b
    WHERE o.status IN ('paid', 'shipped')
      AND timezone('Asia/Manila', o.created_at)::date BETWEEN b.previous_start AND b.end_day
  ), buckets AS (
    SELECT CASE WHEN b.span <= 31 THEN days.day::date ELSE date_trunc('month', days.day)::date END AS bucket
    FROM bounds b
    CROSS JOIN LATERAL generate_series(
      CASE WHEN b.span <= 31 THEN b.start_day::timestamp ELSE date_trunc('month', b.start_day::timestamp) END,
      CASE WHEN b.span <= 31 THEN b.end_day::timestamp ELSE date_trunc('month', b.end_day::timestamp) END,
      CASE WHEN b.span <= 31 THEN interval '1 day' ELSE interval '1 month' END
    ) AS days(day)
  ), trend AS (
    SELECT bu.bucket,
      COALESCE(SUM(pa.total) FILTER (WHERE pa.day BETWEEN b.start_day AND b.end_day), 0) AS total
    FROM buckets bu CROSS JOIN bounds b
    LEFT JOIN paid pa ON CASE WHEN b.span <= 31 THEN pa.day = bu.bucket
      ELSE date_trunc('month', pa.day)::date = bu.bucket END
    GROUP BY bu.bucket
  ), top_products AS (
    SELECT p.name, SUM(oi.qty)::integer AS quantity, SUM(oi.qty * oi.unit_price) AS revenue
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.variants v ON v.id = oi.variant_id
    JOIN public.products p ON p.id = v.product_id
    CROSS JOIN bounds b
    WHERE o.status IN ('paid', 'shipped')
      AND timezone('Asia/Manila', o.created_at)::date BETWEEN b.start_day AND b.end_day
    GROUP BY p.name ORDER BY revenue DESC, quantity DESC LIMIT 5
  )
  SELECT jsonb_build_object(
    'start', b.start_day, 'end', b.end_day,
    'sales', COALESCE((SELECT SUM(total) FROM paid WHERE day BETWEEN b.start_day AND b.end_day), 0),
    'order_count', (SELECT COUNT(*) FROM paid WHERE day BETWEEN b.start_day AND b.end_day),
    'average_order', COALESCE((SELECT AVG(total) FROM paid WHERE day BETWEEN b.start_day AND b.end_day), 0),
    'previous_sales', COALESCE((SELECT SUM(total) FROM paid WHERE day BETWEEN b.previous_start AND b.start_day - 1), 0),
    'previous_order_count', (SELECT COUNT(*) FROM paid WHERE day BETWEEN b.previous_start AND b.start_day - 1),
    'trend', COALESCE((SELECT jsonb_agg(jsonb_build_object('dateKey', bucket, 'label',
      CASE WHEN b.span <= 31 THEN to_char(bucket, 'Mon DD') ELSE to_char(bucket, 'Mon YYYY') END,
      'total', total) ORDER BY bucket) FROM trend), '[]'::jsonb),
    'top_products', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'revenue', revenue)) FROM top_products), '[]'::jsonb)
  ) FROM bounds b;
$$;

REVOKE ALL ON FUNCTION public.get_sales_performance(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_performance(date, date) TO authenticated;
