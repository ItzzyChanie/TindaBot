CREATE OR REPLACE VIEW public.public_catalog
WITH (security_barrier = true)
AS
SELECT
  p.id,
  p.name,
  p.description,
  p.image_url,
  p.price,
  p.discount_type,
  p.discount_value,
  p.discount_starts,
  p.discount_ends,
  COALESCE(variants.sizes, '[]'::jsonb) AS sizes,
  COALESCE(promos.promos, '[]'::jsonb) AS promos
FROM public.products AS p
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'size', v.size,
      'availability', CASE
        WHEN v.stock <= 0 THEN 'sold_out'
        WHEN v.stock <= 2 THEN 'low_stock'
        ELSE 'in_stock'
      END
    ) ORDER BY v.size
  ) AS sizes
  FROM public.variants AS v
  WHERE v.product_id = p.id
) AS variants ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', pr.label,
      'kind', pr.kind,
      'min_qty', pr.min_qty,
      'value', pr.value,
      'starts_at', pr.starts_at,
      'ends_at', pr.ends_at,
      'active', pr.active
    ) ORDER BY pr.min_qty, pr.label
  ) AS promos
  FROM public.promos AS pr
  WHERE pr.product_id = p.id AND pr.active = true
) AS promos ON true
WHERE p.active = true;

COMMENT ON VIEW public.public_catalog IS
  'Safe public storefront data. Availability labels do not expose stock counts; low_stock means one or two units.';

REVOKE ALL ON TABLE public.products, public.variants, public.promos FROM anon;
REVOKE ALL ON TABLE public.public_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_catalog TO anon, authenticated;
