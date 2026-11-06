import { runNotificationReminders } from "../_shared/notify.ts";

function matchesSecret(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expectedSecret = Deno.env.get("NOTIFICATION_SCHEDULER_SECRET") ?? "";
  const providedSecret = request.headers.get("x-notification-scheduler-secret") ?? "";
  if (expectedSecret.length < 32 || !matchesSecret(providedSecret, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runNotificationReminders();
  return Response.json(result, { status: result.ok ? 200 : 503 });
});
