import type { SyncableEvent } from "../types";
import { resolveIsAllDayEvent } from "./all-day";
import { htmlToPlainText, isHtmlDescription } from "./html-description";
import stringify from "fast-json-stable-stringify";

type SyncableEventContent = Pick<SyncableEvent, "summary" | "description" | "location">
  & Partial<Pick<
    SyncableEvent,
    | "availability"
    | "isAllDay"
    | "startTime"
    | "endTime"
    | "startTimeZone"
    | "recurrenceRule"
    | "recurrenceDuration"
    | "exceptionDates"
    | "recurrenceId"
  >>;

const normalizeText = (value?: string): string =>
  value?.replaceAll(/\r\n?/g, "\n").trim() ?? "";
/*
 * CalDAV destinations write HTML descriptions as plain text (see caldav/shared/ics.ts) and
 * therefore read them back as plain text, so the editable-content comparison must hash the same
 * plain-text form on both sides. Hashing raw HTML locally against a plain-text readback would
 * mark every HTML-description event as perpetually changed, causing an endless re-push loop.
 */
const normalizeEditableDescription = (value = ""): string => {
  if (isHtmlDescription(value)) {
    return normalizeText(htmlToPlainText(value));
  }
  return normalizeText(value);
};
const normalizeAvailability = (value?: SyncableEvent["availability"]): string => value ?? "busy";
const resolveHashedAllDay = (event: SyncableEventContent): boolean => {
  if (event.startTime && event.endTime) {
    return resolveIsAllDayEvent({
      endTime: event.endTime,
      isAllDay: event.isAllDay,
      startTime: event.startTime,
    });
  }

  return event.isAllDay ?? false;
};

const createSyncEventContentHash = (event: SyncableEventContent): string => {
  const payload = JSON.stringify([
    normalizeText(event.summary),
    normalizeText(event.description),
    normalizeText(event.location),
    normalizeAvailability(event.availability),
    resolveHashedAllDay(event),
    event.startTime?.toISOString() ?? "",
    event.endTime?.toISOString() ?? "",
    event.startTimeZone ?? "",
    stringify(event.recurrenceDuration ?? null),
    stringify(event.recurrenceRule ?? null),
    [...event.exceptionDates ?? []].map((date) => date.toISOString()).toSorted(),
    event.recurrenceId?.toISOString() ?? "",
  ]);

  return new Bun.CryptoHasher("sha256").update(payload).digest("hex");
};

const createEditableEventContentHash = (event: SyncableEventContent): string => {
  const payload = JSON.stringify([
    normalizeText(event.summary),
    normalizeEditableDescription(event.description),
    normalizeText(event.location),
    resolveHashedAllDay(event),
  ]);

  return new Bun.CryptoHasher("sha256").update(payload).digest("hex");
};

export { createEditableEventContentHash, createSyncEventContentHash };
export type { SyncableEventContent };
