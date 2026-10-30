INSERT INTO public.shop_settings (shop_id)
VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT (shop_id) DO NOTHING;

CREATE FUNCTION public.adjust_variant_stock(p_variant uuid, p_delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_stock integer;
BEGIN
  IF p_delta IS NULL THEN RETURN NULL; END IF;
  UPDATE public.variants
  SET stock = stock + p_delta
  WHERE id = p_variant AND stock + p_delta >= 0
  RETURNING stock INTO updated_stock;
  RETURN updated_stock;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_stock(p_variant uuid, p_qty integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN false; END IF;
  UPDATE public.variants
  SET stock = stock - p_qty
  WHERE id = p_variant AND stock >= p_qty;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_variant_stock(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_variant_stock(uuid, integer) TO authenticated;
REVOKE UPDATE ON TABLE public.variants FROM authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 300000, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 300000,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

CREATE POLICY "Public product image reads" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'product-images');
CREATE POLICY "Authenticated product image uploads" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "Authenticated product image updates" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'product-images') WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "Authenticated product image deletes" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'product-images');
