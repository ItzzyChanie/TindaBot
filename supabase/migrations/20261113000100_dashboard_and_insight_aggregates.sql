CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON public.messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_created_conversation_idx
  ON public.messages (created_at, conversation_id, sender);

CREATE INDEX IF NOT EXISTS conversations_shop_list_idx
  ON public.conversations (is_hidden, last_message_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx
  ON public.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS missed_requests_conversation_created_idx
  ON public.missed_requests (conversation_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_inbox_previews(p_conversation_ids uuid[])
RETURNS TABLE (conversation_id uuid, body text, sender text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id, m.body, m.sender, m.created_at
  FROM public.messages AS m
  WHERE m.conversation_id = ANY(COALESCE(p_conversation_ids, ARRAY[]::uuid[]))
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_overview_metrics(p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH shop AS (
    SELECT '00000000-0000-4000-8000-000000000001'::uuid AS id
  ), daily AS (
    SELECT days.day::date AS day,
      COALESCE(SUM(o.total), 0) AS total
    FROM generate_series(
      (timezone('Asia/Manila', now())::date - 6)::timestamp,
      timezone('Asia/Manila', now())::date::timestamp,
      interval '1 day'
    ) AS days(day)
    LEFT JOIN public.orders AS o
      ON timezone('Asia/Manila', o.created_at)::date = days.day::date
      AND o.created_at >= p_since
      AND o.status IN ('paid', 'shipped')
    GROUP BY days.day::date
  ), activities AS (
    SELECT m.id, c.id AS conversation_id,
      COALESCE(cu.name, 'Customer') AS name, m.body, m.created_at
    FROM public.messages AS m
    JOIN public.conversations AS c ON c.id = m.conversation_id
    JOIN public.customers AS cu ON cu.id = c.customer_id
    WHERE m.sender = 'customer'
    ORDER BY m.created_at DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'open_count', (SELECT COUNT(*) FROM public.conversations c, shop s
      WHERE c.is_hidden = false AND c.status <> 'resolved'),
    'needs_seller', (SELECT COUNT(*) FROM public.conversations c
      WHERE c.is_hidden = false AND c.status = 'needs_seller'),
    'order_count', (SELECT COUNT(*) FROM public.orders o
      WHERE o.status IN ('paid', 'shipped') AND o.created_at >= p_since),
    'sales', (SELECT COALESCE(SUM(o.total), 0) FROM public.orders o
      WHERE o.status IN ('paid', 'shipped') AND o.created_at >= p_since),
    'product_count', (SELECT COUNT(*) FROM public.products p, shop s
      WHERE p.shop_id = s.id AND p.active = true),
    'in_stock', (SELECT COALESCE(SUM(v.stock), 0) FROM public.variants v
      JOIN public.products p ON p.id = v.product_id, shop s
      WHERE p.shop_id = s.id AND p.active = true),
    'sales_trend', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'label', to_char(day, 'Dy'), 'dateKey', to_char(day, 'YYYY-MM-DD'), 'total', total
    ) ORDER BY day) FROM daily), '[]'::jsonb),
    'activities', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'conversationId', conversation_id, 'name', name, 'body', body,
      'time', created_at
    ) ORDER BY created_at DESC) FROM activities), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_shop_insights(
  p_since timestamptz,
  p_missed_limit integer DEFAULT 15,
  p_missed_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT c.id, c.status
    FROM public.conversations c
    JOIN public.customers cu ON cu.id = c.customer_id
    WHERE c.created_at >= p_since
      AND c.is_hidden = false
      AND cu.channel NOT IN ('messenger_simulated', 'instagram_simulated')
  ), message_rows AS (
    SELECT m.id, m.conversation_id, m.sender, m.body, m.created_at,
      COUNT(*) FILTER (WHERE m.sender = 'customer') OVER (
        PARTITION BY m.conversation_id ORDER BY m.created_at, m.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS exchange_id
    FROM public.messages m
    JOIN eligible e ON e.id = m.conversation_id
    WHERE m.created_at >= p_since
      AND m.sender IN ('customer', 'ai', 'seller', 'system')
  ), exchanges AS (
    SELECT conversation_id, exchange_id,
      BOOL_OR(sender = 'customer') AS has_customer,
      (ARRAY_AGG(sender ORDER BY created_at, id)
        FILTER (WHERE sender IN ('ai', 'seller')))[1] = 'ai' AS bot_answered
    FROM message_rows
    GROUP BY conversation_id, exchange_id
  ), intent_rows AS (
    SELECT CASE
      WHEN body_l ~ '(wrong size|wrong item|missing item|damaged|complaint|reklamo|may sira|iba dumating)' THEN 'complaint'
      WHEN body_l ~ '(tracking|nasaan na order|order status|where is my order)' THEN 'status'
      WHEN body_l ~ '(payment|magbayad|down ?payment|deposit|gcash|maya|(^|[^a-z])cod([^a-z]|$))' THEN 'payment'
      WHEN body_l ~ '(size chart|size guide|sizing chart|chart ng size)' THEN 'size_chart'
      WHEN body_l ~ '(bulk|wholesale|maramihan)' THEN 'bulk'
      WHEN body_l ~ '(shipping|delivery fee|courier|ship out|lalamove|delivery)' THEN 'shipping'
      WHEN body_l ~ '(discount|tawad|less pa|best price|may bawas)' THEN 'discount'
      WHEN body_l ~ '(magkano|how much|price|presyo|(^|[^a-z])hm([^a-z]|$)|(^|[^a-z])mp([^a-z]|$))' THEN 'price'
      WHEN body_l ~ '(available|availability|(^|[^a-z])avail([^a-z]|$)|may stock|in stock|anong sizes)' THEN 'availability'
      WHEN body_l ~ '(confirm|order na|checkout|mine|pabili|go na|sige kunin)' THEN 'order_confirm'
      WHEN body_l ~ '(paano mag order|how to order|how to buy)' THEN 'order_help'
      WHEN body_l ~ '(business hours|opening hours|store hours|anong oras kayo bukas)' THEN 'business_hours'
      WHEN body_l ~ '(physical store|shop address|store address|may tindahan|may store)' THEN 'shop_info'
      WHEN body_l ~ '(exchange|return policy|refund policy|can i return|do you accept returns)' THEN 'after_sales'
      WHEN body_l ~ '(restock|material|fabric|stretchable|makapal|actual photo|picture|video|model|legit|scam|review|feedback|color|kulay|reseller)' THEN 'seller_handoff'
      WHEN body_l ~ '^(hi|hello|hey|good morning|good afternoon|good evening|kamusta|kumusta)([ ?!.]|$)' THEN 'greeting'
      WHEN body_l ~ '\?' THEN 'question'
      ELSE 'unknown'
    END AS intent
    FROM (SELECT lower(body) AS body_l FROM message_rows WHERE sender = 'customer') customers
  ), intents AS (
    SELECT intent, COUNT(*) AS count FROM intent_rows GROUP BY intent
  ), missed AS (
    SELECT mr.id, mr.request_text, mr.created_at
    FROM public.missed_requests mr
    JOIN eligible e ON e.id = mr.conversation_id
    ORDER BY mr.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_missed_limit, 15), 1), 100)
    OFFSET GREATEST(COALESCE(p_missed_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'customer_message_count', (SELECT COUNT(*) FROM message_rows WHERE sender = 'customer'),
    'bot_answered_count', (SELECT COUNT(*) FROM exchanges WHERE has_customer AND bot_answered),
    'needs_seller', (SELECT COUNT(*) FROM eligible WHERE status = 'needs_seller'),
    'paid_order_count', (SELECT COUNT(*) FROM public.orders o JOIN eligible e ON e.id = o.conversation_id
      WHERE o.status IN ('paid', 'shipped') AND o.created_at >= p_since),
    'paid_revenue', (SELECT COALESCE(SUM(o.total), 0) FROM public.orders o JOIN eligible e ON e.id = o.conversation_id
      WHERE o.status IN ('paid', 'shipped') AND o.created_at >= p_since),
    'intent_counts', COALESCE((SELECT jsonb_agg(jsonb_build_object('intent', intent, 'count', count)
      ORDER BY count DESC) FROM intents), '[]'::jsonb),
    'missed_requests', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'request_text', request_text, 'created_at', created_at
    ) ORDER BY created_at DESC) FROM missed), '[]'::jsonb),
    'missed_count', (SELECT COUNT(*) FROM public.missed_requests mr
      JOIN eligible e ON e.id = mr.conversation_id)
  );
$$;

REVOKE ALL ON FUNCTION public.get_inbox_previews(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_overview_metrics(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shop_insights(timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inbox_previews(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_overview_metrics(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shop_insights(timestamptz, integer, integer) TO authenticated;
