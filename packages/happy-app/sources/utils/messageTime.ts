/**
 * When a chat message was sent, as shown under it: just the time for today,
 * with the month and day for earlier this year, and the year too before that.
 * Callers pass the app's language rather than relying on the browser's, so a
 * Chinese UI reads 13:26 even on an English system.
 */
export function formatMessageTime(timestamp: number, locale: string, now: number = Date.now()): string {
    const date = new Date(timestamp);
    const today = new Date(now);
    const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const sameYear = date.getFullYear() === today.getFullYear();
    if (sameYear && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) {
        return time;
    }
    const day = date.toLocaleDateString(locale, sameYear
        ? { month: 'numeric', day: 'numeric' }
        : { year: 'numeric', month: 'numeric', day: 'numeric' });
    return `${day} ${time}`;
}
