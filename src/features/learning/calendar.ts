import type { LiveEvent } from './types';

/** RFC 5545 calendar file for a live session, with the join link and a 15-minute reminder. */
export function eventIcs(event: LiveEvent, organizer: string, durationMinutes = 60): string {
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
    `UID:${event.id}@coursiva`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(event.title)}`,
    `ORGANIZER;CN=${esc(organizer)}:mailto:noreply@coursiva.app`,
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

export function downloadIcs(event: LiveEvent, organizer: string) {
  const url = URL.createObjectURL(new Blob([eventIcs(event, organizer)], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${event.title.replace(/[^\w]+/g, '-').toLowerCase()}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
