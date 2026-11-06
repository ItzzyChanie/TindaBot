CREATE OR REPLACE FUNCTION public.set_variant_price(
  p_variant uuid,
  p_price numeric(10, 2)
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_variant uuid;
BEGIN
  UPDATE public.variants
  SET price = p_price
  WHERE id = p_variant
  RETURNING id INTO updated_variant;

  RETURN updated_variant IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.set_variant_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_variant_price(uuid, numeric) TO authenticated;
