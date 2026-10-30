INSERT INTO public.products (id, shop_id, name, aliases, description, price, active, discount_type, discount_value)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Isla Linen Top', ARRAY['Isla blouse'], 'Breathable linen blend top.', 650, true, 'percent', 10),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Sinta Wrap Dress', ARRAY['Sinta dress'], 'Easy wrap dress for everyday wear.', 1290, true, NULL, NULL),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Amihan Cotton Tee', ARRAY['Amihan shirt'], 'Soft cotton relaxed-fit tee.', 450, true, NULL, NULL),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'Tala Pleated Skirt', ARRAY['Tala skirt'], 'Pleated midi skirt.', 890, true, NULL, NULL),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'Luna Knit Cardigan', ARRAY['Luna cardigan'], 'Lightweight knit cardigan.', 1100, true, NULL, NULL),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'Baybay Cropped Pants', ARRAY['Baybay trousers'], 'High-waist cropped trousers.', 980, true, NULL, NULL),
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', 'Dahlia Puff Sleeve Blouse', ARRAY['Dahlia blouse'], 'Puff sleeve button blouse.', 720, true, NULL, NULL),
  ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001', 'Sol Bucket Hat', ARRAY['Sol hat'], 'Cotton bucket hat in one size.', 350, true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, aliases = EXCLUDED.aliases, description = EXCLUDED.description,
  price = EXCLUDED.price, active = EXCLUDED.active, discount_type = EXCLUDED.discount_type,
  discount_value = EXCLUDED.discount_value;

INSERT INTO public.variants (id, product_id, size, stock) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'S', 5),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'M', 8),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'L', 3),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'S', 2),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', 'M', 4),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000002', 'L', 2),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000003', 'S', 6),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000003', 'M', 0),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000004', 'S', 2),
  ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000004', 'M', 3),
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000005', 'S', 2),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000005', 'M', 4),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000006', 'M', 1),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000006', 'L', 1),
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000007', 'S', 3),
  ('20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000007', 'M', 2),
  ('20000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000008', 'One size', 9)
ON CONFLICT (id) DO UPDATE SET size = EXCLUDED.size, stock = EXCLUDED.stock;

INSERT INTO public.promos (id, product_id, label, kind, min_qty, value, active)
VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'Buy 3, save 10%', 'qty_percent', 3, 10, true)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind,
  min_qty = EXCLUDED.min_qty, value = EXCLUDED.value, active = EXCLUDED.active;

-- These are inbox-only transcripts. They do not connect to Messenger or Instagram.
INSERT INTO public.customers (id, channel, external_id, name) VALUES
  ('40000000-0000-4000-8000-000000000001', 'messenger_simulated', 'demo-messenger-001', 'Messenger Demo Customer'),
  ('40000000-0000-4000-8000-000000000002', 'instagram_simulated', 'demo-instagram-001', 'Instagram Demo Customer')
ON CONFLICT (channel, external_id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.conversations (id, customer_id, status, ai_mode, last_message_at)
SELECT '50000000-0000-4000-8000-000000000001', id, 'open', 'human', now()
FROM public.customers WHERE channel = 'messenger_simulated' AND external_id = 'demo-messenger-001'
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, ai_mode = EXCLUDED.ai_mode, last_message_at = now(), is_hidden = false;

INSERT INTO public.conversations (id, customer_id, status, ai_mode, last_message_at)
SELECT '50000000-0000-4000-8000-000000000002', id, 'needs_seller', 'human', now()
FROM public.customers WHERE channel = 'instagram_simulated' AND external_id = 'demo-instagram-001'
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, ai_mode = EXCLUDED.ai_mode, last_message_at = now(), is_hidden = false;

INSERT INTO public.messages (id, conversation_id, sender, body, created_at) VALUES
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'customer', 'Hi po, may Amihan Cotton Tee size M?', now() - interval '1 minute'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'ai', 'Simulation only: Sample Messenger reply. No Messenger API was called.', now() - interval '30 seconds'),
  ('60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', 'customer', 'May plus-size linen top po ba?', now() - interval '1 minute'),
  ('60000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000002', 'ai', 'Simulation only: Ipa-check ko po ito sa seller. No Instagram API was called.', now() - interval '30 seconds')
ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, created_at = EXCLUDED.created_at;

INSERT INTO public.missed_requests (id, conversation_id, request_text)
VALUES ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'May plus-size linen top po ba?')
ON CONFLICT (id) DO NOTHING;
