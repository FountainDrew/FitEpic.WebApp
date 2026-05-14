import { DayActivityRecordResponse } from '../../../core/api/generated/models/day-activity-record-response';

export const DOTS_PER_ROW = 15;
export const MAX_DOTS = 44;

export type VerticalConnectorSide = 'right' | 'left' | 'none';

export interface StreakRow {
  dots: DayActivityRecordResponse[];
  verticalConnectorSide: VerticalConnectorSide;
}

/**
 * Build snake-layout rows from a newest-first list of day-activity records.
 *
 * Web layout (intentionally differs from mobile): today sits at the LEFT edge of row 0,
 * the snake winds rightward, drops down, reads right-to-left, drops down, etc.
 * - cap to 44 dots
 * - chunk into rows of 15
 * - even-indexed rows keep newest-first order (today on left of row 0)
 * - odd-indexed rows are reversed
 * - vertical connector: even-not-last → right, odd-not-last → left, last → none
 */
export function buildStreakRows(
  days: DayActivityRecordResponse[] | null | undefined,
): StreakRow[] {
  if (!days || days.length === 0) return [];

  const capped = days.slice(0, MAX_DOTS);
  const rows: StreakRow[] = [];

  for (let start = 0; start < capped.length; start += DOTS_PER_ROW) {
    const rowIndex = start / DOTS_PER_ROW;
    const chunk = capped.slice(start, start + DOTS_PER_ROW);
    const dots = rowIndex % 2 === 0 ? chunk : [...chunk].reverse();
    rows.push({ dots, verticalConnectorSide: 'none' });
  }

  const lastIndex = rows.length - 1;
  for (let r = 0; r <= lastIndex; r++) {
    if (r === lastIndex) {
      rows[r].verticalConnectorSide = 'none';
    } else {
      rows[r].verticalConnectorSide = r % 2 === 0 ? 'right' : 'left';
    }
  }

  return rows;
}

export function overflowCount(totalDays: number): number {
  return Math.max(0, totalDays - MAX_DOTS);
}
