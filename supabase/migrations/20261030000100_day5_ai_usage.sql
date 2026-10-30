CREATE OR REPLACE FUNCTION public.reserve_ai_usage(p_day date, p_cap integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reserved integer;
BEGIN
  IF p_day IS NULL OR p_cap IS NULL OR p_cap <= 0 THEN RETURN false; END IF;
  INSERT INTO public.ai_usage (day, count)
  VALUES (p_day, 1)
  ON CONFLICT (day) DO UPDATE
    SET count = public.ai_usage.count + 1
    WHERE public.ai_usage.count < p_cap
  RETURNING count INTO reserved;
  RETURN reserved IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_usage(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(date, integer) TO service_role;
