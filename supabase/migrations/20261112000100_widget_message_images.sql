ALTER TABLE public.messages
  ADD COLUMN image_urls text[] NOT NULL DEFAULT '{}'::text[];
