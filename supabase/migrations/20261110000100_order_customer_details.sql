ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_full_name text,
  ADD COLUMN IF NOT EXISTS customer_address text,
  ADD COLUMN IF NOT EXISTS customer_mobile text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_notes text;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_customer_details_length_check CHECK (
    (customer_full_name IS NULL OR length(customer_full_name) <= 160) AND
    (customer_address IS NULL OR length(customer_address) <= 500) AND
    (customer_mobile IS NULL OR length(customer_mobile) <= 40) AND
    (customer_email IS NULL OR length(customer_email) <= 254) AND
    (customer_notes IS NULL OR length(customer_notes) <= 500)
  );
