import { afterEach, describe, expect, it, vi } from "vitest";
import { sendToChannel } from "../supabase/functions/_shared/channel-messaging";

describe("channel image delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the text reply and image attachment through Messenger", async () => {
    vi.stubGlobal("Deno", { env: { get: (name: string) => name === "MESSENGER_PAGE_TOKEN" ? "test-token" : undefined } });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendToChannel("messenger", "test-psid", "Narito po ang size chart ng shop.", {
      imageUrls: ["https://example.com/chart.png"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v26.0/me/messages");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      recipient: { id: "test-psid" },
      message: { text: "Narito po ang size chart ng shop." },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      recipient: { id: "test-psid" },
      message: { attachment: { type: "image", payload: { url: "https://example.com/chart.png" } } },
    });
  });
});
