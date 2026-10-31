ALTER TABLE public.products
  ADD COLUMN colors text[] NOT NULL DEFAULT '{}',
  ADD COLUMN material text NOT NULL DEFAULT '',
  ADD COLUMN fabric_details text NOT NULL DEFAULT '',
  ADD COLUMN fit_notes text NOT NULL DEFAULT '',
  ADD COLUMN size_guidance text NOT NULL DEFAULT '',
  ADD COLUMN restock_note text NOT NULL DEFAULT '',
  ADD COLUMN model_details text NOT NULL DEFAULT '',
  ADD COLUMN photos_are_actual boolean NOT NULL DEFAULT false,
  ADD COLUMN additional_images text[] NOT NULL DEFAULT '{}',
  ADD COLUMN video_url text NOT NULL DEFAULT '';
