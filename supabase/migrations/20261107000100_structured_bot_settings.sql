ALTER TABLE public.shop_settings
  ADD COLUMN bot_options jsonb NOT NULL DEFAULT '{"bulk_orders":false,"payment_methods":[],"couriers":[],"after_sales":{"exchange":false,"return":false,"refund":false},"free_shipping_minimum":0,"processing_days":1}'::jsonb;
