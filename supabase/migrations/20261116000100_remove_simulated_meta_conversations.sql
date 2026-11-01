-- Remove only the two fixed mock inbox conversations from the test fixture migration.
UPDATE public.conversations AS conversation
SET last_customer_message_at = (
  SELECT max(message.created_at)
  FROM public.messages AS message
  WHERE message.conversation_id = conversation.id
    AND message.sender = 'customer'
)
FROM public.customers AS customer
WHERE customer.id = conversation.customer_id
  AND customer.channel IN ('messenger', 'instagram')
  AND conversation.last_customer_message_at IS NULL;

DELETE FROM public.missed_requests
WHERE id = '70000000-0000-4000-8000-000000000001';

DELETE FROM public.conversations
WHERE id IN (
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002'
);

DELETE FROM public.customers
WHERE id IN (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
)
AND channel IN ('messenger_simulated', 'instagram_simulated');
