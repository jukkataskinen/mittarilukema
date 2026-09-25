import { afterEach, describe, expect, it, vi } from "vitest";
import { letterSender } from "@/lib/letters";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Postita", () => {
  it("lataa PDF:n url-turvallisena base64:nä vahvistamattomana ja jakaa sen kirjeiksi", async () => {
    vi.stubEnv("LETTER_MODE", "postita");
    vi.stubEnv("POSTITA_USERNAME", "tunnus");
    vi.stubEnv("POSTITA_PASSWORD", "salasana");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 70579, status: "NE", price: "4.68", recipient_count: 2 }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const job = await letterSender().upload({ jobName: "Tiedote", pdf: new Uint8Array([0xfb, 0xff, 0xfe]), pagesPerLetter: 2, letters: 2, postClass: 2 });
    expect(job).toEqual({ id: "70579", status: "NE", price: 4.68, recipients: 2 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://postita.fi/api/send/");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("tunnus:salasana").toString("base64")}`);
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toMatchObject({ job_name: "Tiedote", post_class: "2", pdf_splitter: "2", confirm: "false", pdf: "-__-" });
  });

  it("ilman tunnuksia ei yritetä lähettää", () => {
    vi.stubEnv("LETTER_MODE", "postita");
    vi.stubEnv("POSTITA_USERNAME", "");
    expect(() => letterSender()).toThrow(/tunnukset puuttuvat/);
  });
});
