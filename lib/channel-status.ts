import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type ChannelStatus = {
  telegram: boolean;
  messenger: boolean;
  instagram: boolean;
};

export async function fetchChannelStatus(): Promise<ChannelStatus> {
  const { data, error } = await createSupabaseBrowserClient().functions.invoke("channel-status");
  if (error) throw error;
  const channels = (data as { channels?: Partial<ChannelStatus> } | null)?.channels;
  if (!channels || typeof channels.telegram !== "boolean" || typeof channels.messenger !== "boolean" || typeof channels.instagram !== "boolean") {
    throw new Error("Channel status is unavailable");
  }
  return channels as ChannelStatus;
}
