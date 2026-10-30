-- Fixed mock transcripts for the inbox. These records are not connected to channel APIs.
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
