-- Add mock catalog items for local demos and chat quoting.
INSERT INTO public.products (
  id, shop_id, name, aliases, description, price, active,
  discount_type, discount_value
)
VALUES
  (
    '10000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000001',
    'Bayanihan Basic T-Shirt',
    ARRAY['t-shirt', 'basic tee', 'cotton t-shirt'],
    'Soft cotton everyday t-shirt.',
    450.00, true, NULL, NULL
  ),
  (
    '10000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000001',
    'Habi Ribbed Tank Top',
    ARRAY['ribbed tank', 'tank top'],
    'Stretchy ribbed tank top for everyday outfits.',
    390.00, true, NULL, NULL
  ),
  (
    '10000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000001',
    'Liway Midi Skirt',
    ARRAY['midi skirt', 'Liway skirt'],
    'Flowy midi skirt with a comfortable waistband.',
    890.00, true, 'percent', 10.00
  ),
  (
    '10000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000001',
    'Amara Linen Trousers',
    ARRAY['linen pants', 'linen trousers'],
    'Relaxed-fit linen trousers with side pockets.',
    1090.00, true, 'fixed', 100.00
  )
ON CONFLICT (id) DO UPDATE SET
  shop_id = EXCLUDED.shop_id,
  name = EXCLUDED.name,
  aliases = EXCLUDED.aliases,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  active = EXCLUDED.active,
  discount_type = EXCLUDED.discount_type,
  discount_value = EXCLUDED.discount_value;

INSERT INTO public.variants (id, product_id, size, stock)
VALUES
  ('20000000-0000-4000-8000-000000000018', '10000000-0000-4000-8000-000000000009', 'S', 8),
  ('20000000-0000-4000-8000-000000000019', '10000000-0000-4000-8000-000000000009', 'M', 12),
  ('20000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000009', 'L', 7),
  ('20000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000010', 'S', 5),
  ('20000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000010', 'M', 6),
  ('20000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000010', 'L', 4),
  ('20000000-0000-4000-8000-000000000024', '10000000-0000-4000-8000-000000000011', 'S', 4),
  ('20000000-0000-4000-8000-000000000025', '10000000-0000-4000-8000-000000000011', 'M', 5),
  ('20000000-0000-4000-8000-000000000026', '10000000-0000-4000-8000-000000000011', 'L', 3),
  ('20000000-0000-4000-8000-000000000027', '10000000-0000-4000-8000-000000000012', 'S', 3),
  ('20000000-0000-4000-8000-000000000028', '10000000-0000-4000-8000-000000000012', 'M', 4),
  ('20000000-0000-4000-8000-000000000029', '10000000-0000-4000-8000-000000000012', 'L', 2)
ON CONFLICT (id) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  size = EXCLUDED.size,
  stock = EXCLUDED.stock;

INSERT INTO public.promos (
  id, product_id, label, kind, min_qty, value, active
)
VALUES (
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000010',
  'Buy 3, save 10%',
  'qty_percent',
  3,
  10.00,
  true
)
ON CONFLICT (id) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  label = EXCLUDED.label,
  kind = EXCLUDED.kind,
  min_qty = EXCLUDED.min_qty,
  value = EXCLUDED.value,
  active = EXCLUDED.active;
