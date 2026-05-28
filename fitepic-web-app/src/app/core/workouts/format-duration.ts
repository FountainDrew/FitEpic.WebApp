/**
 * Format an `hh:mm:ss` duration string for display, preserving second-level
 * precision. Use for per-workout duration values where the athlete logged a
 * precise time (e.g. `9:33` for a For Time workout) — rounding to whole
 * minutes here would lose load-bearing information.
 *
 * Output examples:
 *   - `""`            null / zero
 *   - `"9:33"`        under an hour with seconds
 *   - `"47 min"`      under an hour, exact minutes
 *   - `"1h 12m 30s"`  over an hour with seconds
 *   - `"1h 12m"`      over an hour, no seconds
 *   - `"2h"`          exact hours
 *
 * Pairs with the API's `hh:mm:ss` `Duration` projection on
 * `DashboardWorkoutCardResponse` / `WorkoutResponse`. Aggregate-total fields
 * (`*DurationMinutes` on weekly / monthly stats) keep their integer-minute
 * formatter inline at their call sites — those are sums where minute
 * resolution is appropriate.
 */
export function formatDurationFromIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const [h, m, s] = iso.split(':').map(Number);
  const hours = h || 0;
  const mins = m || 0;
  const secs = s || 0;
  if (hours === 0 && mins === 0 && secs === 0) return '';
  if (hours === 0) {
    if (secs === 0) return `${mins} min`;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }
  const parts = [`${hours}h`];
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0) parts.push(`${secs}s`);
  return parts.join(' ');
}
