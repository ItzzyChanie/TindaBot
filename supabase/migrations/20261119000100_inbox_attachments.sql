ALTER TABLE public.messages
  ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(attachments) = 'array');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inbox-attachments',
  'inbox-attachments',
  false,
  26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Authenticated inbox attachment reads" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'inbox-attachments'
    AND (storage.foldername(name))[1] = 'conversations'
  );

CREATE POLICY "Authenticated inbox attachment uploads" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inbox-attachments'
    AND (storage.foldername(name))[1] = 'conversations'
  );

CREATE POLICY "Authenticated inbox attachment deletes" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'inbox-attachments'
    AND (storage.foldername(name))[1] = 'conversations'
  );
