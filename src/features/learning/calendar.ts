import type { LiveEvent } from './types';

/** Who the invite is from: the school, with its support address when it has one (no platform address is assumed). */
export interface Organizer {
  name: string;
  email: string;
}

/** A live event, with its real length when the caller has it (`/me/live/{id}`, schedule rows). */
export type CalendarEvent = LiveEvent & { durationMin?: number };

/**
 * RFC 5545 calendar file for a live session, with the join link and a 15-minute reminder. The end is the session's
 * real length (`durationMin`); only an event without one (the dashboard's `next_event`) falls back to an hour.
 */
export function eventIcs(event: CalendarEvent, organizer: Organizer, durationMinutes = event.durationMin ?? 60): string {
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const start = new Date(event.startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Coursiva//Learner site//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@${organizer.email.split('@')[1] || 'live-session'}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(event.title)}`,
    // ORGANIZER needs an address; without the school's support e-mail the (optional) property is left out.
    ...(organizer.email ? [`ORGANIZER;CN=${esc(organizer.name)}:mailto:${organizer.email}`] : []),
    ...(event.joinUrl ? [`URL:${event.joinUrl}`, `DESCRIPTION:${esc(`Join: ${event.joinUrl}`)}`] : []),
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(event.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function downloadIcs(event: CalendarEvent, organizer: Organizer) {
  const url = URL.createObjectURL(new Blob([eventIcs(event, organizer)], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${event.title.replace(/[^\w]+/g, '-').toLowerCase()}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
