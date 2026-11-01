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

  it("uses the Instagram Login Send API and logs only its HTTP status", async () => {
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => ({
        INSTAGRAM_ACCESS_TOKEN: "private-test-token",
        INSTAGRAM_ACCOUNT_ID: "ig-business-id",
      } as Record<string, string>)[name] },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    await sendToChannel("instagram", "ig-scoped-customer-id", "Private test message");

    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.instagram.com/v26.0/ig-business-id/messages");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ authorization: "Bearer private-test-token" });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      recipient: { id: "ig-scoped-customer-id" },
      message: { text: "Private test message" },
    });
    expect(logSpy).toHaveBeenCalledWith("Channel send result", {
      channel: "instagram",
      requestKind: "text",
      httpStatus: 200,
      success: true,
    });
    const serializedLogs = JSON.stringify(logSpy.mock.calls);
    expect(serializedLogs).not.toContain("private-test-token");
    expect(serializedLogs).not.toContain("Private test message");
    logSpy.mockRestore();
  });
});
