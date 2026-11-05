# Inbox attachment retention setup

The `purge-expired-attachments` Edge Function removes attachments for conversations inactive for 90 days, then calls the existing chat-data purge function. Deploy the function after applying migrations.

To run it every day before the existing 18:17 UTC database retention job, first store the project URL and service-role key in Supabase Vault from the SQL Editor. Use the project URL and key from the Supabase Dashboard; do not add them to this repository.

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'tindabot_project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'tindabot_service_role_key');
```

Then schedule the function at 18:16 UTC:

```sql
create extension if not exists pg_net;

select cron.schedule(
  'tindabot-purge-expired-attachments',
  '16 18 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tindabot_project_url') || '/functions/v1/purge-expired-attachments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'tindabot_service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tindabot_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Check the job history in Supabase Cron after its first run. The database purge leaves conversations with attachment metadata in place if Storage cleanup has not completed, so a failed cleanup can retry on the next run.

The Storage bucket limit is 25 MiB per file. Confirm the project's global Storage limit is at least 25 MiB; Supabase's per-bucket limit cannot exceed the global setting.
