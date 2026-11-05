ALTER TABLE public.messages
  ADD COLUMN channel_message_ids text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN reply_to_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN reply_to_text text,
  ADD COLUMN edited_at timestamptz,
  ADD COLUMN unsent_at timestamptz;

CREATE INDEX messages_reply_to_message_id_idx
  ON public.messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
