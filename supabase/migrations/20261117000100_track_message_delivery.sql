ALTER TABLE public.messages
  DROP CONSTRAINT messages_delivery_status_check,
  ADD CONSTRAINT messages_delivery_status_check
    CHECK (delivery_status IN ('pending', 'sent', 'failed'));
