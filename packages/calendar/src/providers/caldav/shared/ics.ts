import { generateIcsCalendar } from "ts-ics";
import {
  applyCalendarTimeZoneToFloatingEventDates,
  buildZonedIcsDate,
  normalizeTimezone,
  parseIcsCalendar,
  parseIcsEvents,
} from "../../../ics";
import type {
  IcsCalendar,
  IcsEvent,
  IcsExceptionDates,
  IcsRecurrenceRule,
} from "ts-ics";
import type { MaterializedSyncableEvent, SyncableEvent } from "../../../core/types";
import { isKeeperEvent } from "../../../core/events/identity";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  assertNoUnsupportedRecurrenceDates,
  assertSupportedRecurrenceTimeZones,
} from "../../../ics/utils/validate-recurrence-input";

const normalizeIcsText = (value: string | undefined): string | undefined =>
  value?.replaceAll(/\r\n?/g, "\n");

const HTML_TAG_PATTERN = /<[^>]*>/g;
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&apos;": "'",
  "&#39;": "'",
};
const ANCHOR_PATTERN = /<a\b[^>]*?href="([^"]*)"[^>]*?>([\s\S]*?)<\/a>/gi;
const ICS_LINE_MAX_OCTETS = 75;

const isHtmlDescription = (text: string): boolean => /<\/?\w+[^>]*>/.test(text);

const htmlToPlainText = (html: string): string => {
  const withAnchorsConverted = html.replace(ANCHOR_PATTERN, (_match, href: string, text: string) => {
    const plainText = text.replaceAll(HTML_TAG_PATTERN, "").replaceAll(/[\r\n\t ]+/g, " ").trim();
    if (!plainText || plainText === href) {
      return href;
    }
    return `${plainText} (${href})`;
  });
  const withoutTags = withAnchorsConverted.replaceAll(HTML_TAG_PATTERN, "");
  const decoded = withoutTags.replaceAll(
    /&(?:nbsp|amp|lt|gt|quot|apos|#39);/g,
    (entity) => HTML_ENTITIES[entity] ?? entity,
  );
  return decoded.replaceAll(/[\r\n\t ]+/g, " ").trim();
};

const foldIcsLine = (line: string): string => {
  if (Buffer.byteLength(line, "utf8") <= ICS_LINE_MAX_OCTETS) {
    return line;
  }
  const parts: string[] = [];
  let remaining = line;
  while (Buffer.byteLength(remaining, "utf8") > ICS_LINE_MAX_OCTETS) {
    let cut = ICS_LINE_MAX_OCTETS;
    while (cut > 0 && Buffer.byteLength(remaining.slice(0, cut), "utf8") > ICS_LINE_MAX_OCTETS) {
      cut--;
    }
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  parts.push(remaining);
  return parts.join("\r\n ");
};

const eventToICalString = (event: MaterializedSyncableEvent, uid: string): string => {
  const isAllDay = resolveIsAllDayEvent(event);

  const rawDescription = event.description;
  const descriptionIsHtml = Boolean(rawDescription) && isHtmlDescription(rawDescription ?? "");
  const plainDescription = descriptionIsHtml && rawDescription
    ? htmlToPlainText(rawDescription)
    : normalizeIcsText(rawDescription);

  const icsEvent: IcsEvent = {
    description: plainDescription,
    end: buildZonedIcsDate(event.endTime, event.startTimeZone, isAllDay),
    location: normalizeIcsText(event.location),
    stamp: { date: new Date() },
    start: buildZonedIcsDate(event.startTime, event.startTimeZone, isAllDay),
    summary: event.summary.replaceAll(/\r\n?/g, "\n"),
    ...(event.availability === "free" && { timeTransparent: "TRANSPARENT" }),
    ...(event.isPrivate && { class: "PRIVATE" }),
    uid,
  };

  const calendar: IcsCalendar = {
    events: [icsEvent],
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
  };

  const baseIcs = generateIcsCalendar(calendar);

  if (!descriptionIsHtml || !rawDescription) {
    return baseIcs;
  }

  // Inject X-ALT-DESC with the original HTML before END:VEVENT for clients that support rich descriptions.
  const escapedHtml = rawDescription
    .replaceAll("\\", String.raw`\\`)
    .replaceAll(";", String.raw`\;`)
    .replaceAll(",", String.raw`\,`)
    .replaceAll(/\r?\n/g, String.raw`\n`);
  const altDescLine = `X-ALT-DESC;FMTTYPE=text/html:${escapedHtml}`;
  const folded = foldIcsLine(altDescLine);
  return baseIcs.replace(/END:VEVENT\r\n/, `${folded}\r\nEND:VEVENT\r\n`);
};

interface ParsedCalendarEvent {
  availability?: SyncableEvent["availability"];
  deleteId: string;
  endTime: Date;
  isKeeperEvent: boolean;
  isAllDay?: boolean;
  startTime: Date;
  uid: string;
  title?: string;
  description?: string;
  location?: string;
  startTimeZone?: string;
  recurrenceRule?: IcsRecurrenceRule;
  recurrenceDuration?: SyncableEvent["recurrenceDuration"];
  exceptionDates?: IcsExceptionDates;
  recurrenceId?: Date;
}

interface ParseICalCalendarsOptions {
  rejectUnsupportedRecurrenceDates?: boolean;
}

const parseICalCalendarsToRemoteEvents = (
  icsStrings: string[],
  options: ParseICalCalendarsOptions = {},
): ParsedCalendarEvent[] => {
  const calendars = icsStrings.map((icsString) => {
    if (options.rejectUnsupportedRecurrenceDates !== false) {
      assertNoUnsupportedRecurrenceDates(icsString);
    }
    const initialCalendar = parseIcsCalendar({ icsString });
    const normalizedIcs = applyCalendarTimeZoneToFloatingEventDates(
      icsString,
      normalizeTimezone(initialCalendar.nonStandard?.wrTimezone),
    );
    if (normalizedIcs === icsString) {
      return initialCalendar;
    }
    return parseIcsCalendar({ icsString: normalizedIcs });
  });
  const [firstCalendar] = calendars;
  if (!firstCalendar) {
    return [];
  }
  const calendar = {
    ...firstCalendar,
    events: calendars.flatMap((entry) => entry.events ?? []),
  };
  const events = parseIcsEvents(calendar, { includeKeeperEvents: true });
  assertSupportedRecurrenceTimeZones(events);
  return events.map((event) => ({
    availability: event.availability ?? "busy",
    deleteId: event.uid,
    description: event.description,
    endTime: event.endTime,
    exceptionDates: event.exceptionDates,
    recurrenceId: event.recurrenceId,
    isKeeperEvent: isKeeperEvent(event.uid),
    isAllDay: event.isAllDay,
    location: event.location,
    recurrenceDuration: event.recurrenceDuration,
    recurrenceRule: event.recurrenceRule,
    startTime: event.startTime,
    startTimeZone: event.startTimeZone,
    title: event.title,
    uid: event.uid,
  }));
};

const parseICalToRemoteEvents = (icsString: string): ParsedCalendarEvent[] =>
  parseICalCalendarsToRemoteEvents([icsString]);

const parseICalToRemoteEvent = (icsString: string): ParsedCalendarEvent | null => {
  const [event] = parseICalToRemoteEvents(icsString);
  return event ?? null;
};

export {
  eventToICalString,
  parseICalCalendarsToRemoteEvents,
  parseICalToRemoteEvent,
  parseICalToRemoteEvents,
};
export type { ParseICalCalendarsOptions };
