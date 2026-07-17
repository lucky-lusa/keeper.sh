import { afterEach, describe, expect, it } from "vitest";
import { listUserCalendars } from "../../../../../src/providers/outlook/source/utils/list-calendars";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockCalendarListResponse = (
  calendars: { id: string; name: string; owner?: { name?: string; address?: string } }[],
): void => {
  const mockFetch = (): Promise<Response> => Promise.resolve(Response.json({ value: calendars }));
  mockFetch.preconnect = originalFetch.preconnect;
  globalThis.fetch = mockFetch;
};

describe("listUserCalendars", () => {
  it("returns all calendars when no owner email is given", async () => {
    mockCalendarListResponse([
      { id: "cal-own", name: "Own calendar", owner: { address: "me@example.com" } },
      { id: "cal-shared", name: "Colleague calendar", owner: { address: "colleague@example.com" } },
    ]);

    const calendars = await listUserCalendars("test-token");

    expect(calendars.map((entry) => entry.id)).toEqual(["cal-own", "cal-shared"]);
  });

  it("excludes calendars owned by a different mailbox when an owner email is given", async () => {
    mockCalendarListResponse([
      { id: "cal-own", name: "Own calendar", owner: { address: "me@example.com" } },
      { id: "cal-shared", name: "Colleague calendar", owner: { address: "colleague@example.com" } },
    ]);

    const calendars = await listUserCalendars("test-token", "me@example.com");

    expect(calendars.map((entry) => entry.id)).toEqual(["cal-own"]);
  });

  it("compares owner emails case-insensitively", async () => {
    mockCalendarListResponse([
      { id: "cal-own", name: "Own calendar", owner: { address: "Me@Example.com" } },
    ]);

    const calendars = await listUserCalendars("test-token", "me@example.com");

    expect(calendars.map((entry) => entry.id)).toEqual(["cal-own"]);
  });

  it("keeps calendars with no owner info at all when filtering by owner email", async () => {
    mockCalendarListResponse([
      { id: "cal-no-owner", name: "Default calendar" },
    ]);

    const calendars = await listUserCalendars("test-token", "me@example.com");

    expect(calendars.map((entry) => entry.id)).toEqual(["cal-no-owner"]);
  });
});
