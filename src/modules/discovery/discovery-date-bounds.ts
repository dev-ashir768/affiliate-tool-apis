/**
 * Inclusive calendar-day bounds for Discover `updatedAt` filters.
 * `from`/`to` are `yyyy-MM-dd`; empty/missing → omitted.
 * Upper bound is exclusive next-day midnight so a single day includes the whole day.
 */
export function updatedAtBounds(
  from?: string,
  to?: string,
): { gte?: Date; lt?: Date } {
  const out: { gte?: Date; lt?: Date } = {};
  const fromDay = from?.trim();
  const toDay = to?.trim();
  if (fromDay) {
    out.gte = new Date(`${fromDay}T00:00:00.000Z`);
  }
  if (toDay) {
    const start = new Date(`${toDay}T00:00:00.000Z`);
    out.lt = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}
