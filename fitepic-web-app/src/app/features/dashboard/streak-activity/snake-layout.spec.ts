import { DayActivityRecordResponse } from '../../../core/api/generated/models/day-activity-record-response';
import {
  DEFAULT_MAX_DOTS,
  EXPANDED_MAX_DOTS,
  buildStreakRows,
  overflowCount,
} from './snake-layout';

function makeDays(count: number): DayActivityRecordResponse[] {
  // newest-first: index 0 is "today", index 1 is yesterday, etc.
  // Encode the chronological position in `date` so tests can assert ordering.
  return Array.from({ length: count }, (_, i) => ({
    date: `day-${i}`,
    state: 'Completed' as const,
  }));
}

describe('buildStreakRows', () => {
  it('returns [] for empty input', () => {
    expect(buildStreakRows([])).toEqual([]);
    expect(buildStreakRows(null)).toEqual([]);
    expect(buildStreakRows(undefined)).toEqual([]);
  });

  it('renders a single dot when given one day', () => {
    const rows = buildStreakRows(makeDays(1));
    expect(rows.length).toBe(1);
    expect(rows[0].dots.length).toBe(1);
    expect(rows[0].dots[0].date).toBe('day-0');
    expect(rows[0].verticalConnectorSide).toBe('none');
  });

  it('keeps the first row so today sits on the left (14 days)', () => {
    const rows = buildStreakRows(makeDays(14));
    expect(rows.length).toBe(1);
    expect(rows[0].dots.length).toBe(14);
    // visual L→R should be newest → oldest, so first element is day-0 (today) and last is day-13
    expect(rows[0].dots[0].date).toBe('day-0');
    expect(rows[0].dots[13].date).toBe('day-13');
    expect(rows[0].verticalConnectorSide).toBe('none');
  });

  it('handles exactly 15 days (single full row, last, no connector)', () => {
    const rows = buildStreakRows(makeDays(15));
    expect(rows.length).toBe(1);
    expect(rows[0].dots.length).toBe(15);
    expect(rows[0].dots[0].date).toBe('day-0');
    expect(rows[0].dots[14].date).toBe('day-14');
    expect(rows[0].verticalConnectorSide).toBe('none');
  });

  it('handles 16 days (forces a second row)', () => {
    const rows = buildStreakRows(makeDays(16));
    expect(rows.length).toBe(2);

    // row 0: even, kept, today on the left
    expect(rows[0].dots.length).toBe(15);
    expect(rows[0].dots[0].date).toBe('day-0');
    expect(rows[0].dots[14].date).toBe('day-14');
    expect(rows[0].verticalConnectorSide).toBe('right');

    // row 1: odd, reversed, single dot, no connector (it's last)
    expect(rows[1].dots.length).toBe(1);
    expect(rows[1].dots[0].date).toBe('day-15');
    expect(rows[1].verticalConnectorSide).toBe('none');
  });

  it('handles exactly 45 days (default cap exactly hit, 3 full rows, no overflow)', () => {
    const days = makeDays(45);
    const rows = buildStreakRows(days);
    expect(rows.length).toBe(3);

    // row 0: even (kept), 15 dots, today on left, connector right
    expect(rows[0].dots.length).toBe(15);
    expect(rows[0].dots[0].date).toBe('day-0');
    expect(rows[0].dots[14].date).toBe('day-14');
    expect(rows[0].verticalConnectorSide).toBe('right');

    // row 1: odd (reversed), 15 dots, day-29 on left, day-15 on right, connector left
    expect(rows[1].dots.length).toBe(15);
    expect(rows[1].dots[0].date).toBe('day-29');
    expect(rows[1].dots[14].date).toBe('day-15');
    expect(rows[1].verticalConnectorSide).toBe('left');

    // row 2: even (kept), 15 dots, day-30 on left, day-44 on right, no connector (last)
    expect(rows[2].dots.length).toBe(15);
    expect(rows[2].dots[0].date).toBe('day-30');
    expect(rows[2].dots[14].date).toBe('day-44');
    expect(rows[2].verticalConnectorSide).toBe('none');

    expect(overflowCount(days.length)).toBe(0);
  });

  it('caps to default 45 dots and reports the overflow (46 days → overflow 1)', () => {
    const days = makeDays(46);
    const rows = buildStreakRows(days);
    expect(rows.length).toBe(3);
    expect(rows[0].dots.length + rows[1].dots.length + rows[2].dots.length).toBe(DEFAULT_MAX_DOTS);
    expect(overflowCount(days.length)).toBe(1);
  });

  it('caps to default 45 dots and reports the overflow (90 days → overflow 45)', () => {
    const days = makeDays(90);
    const rows = buildStreakRows(days);
    expect(rows.length).toBe(3);
    expect(rows[0].dots.length + rows[1].dots.length + rows[2].dots.length).toBe(DEFAULT_MAX_DOTS);
    expect(overflowCount(days.length)).toBe(45);
  });

  it('overflowCount never goes negative', () => {
    expect(overflowCount(0)).toBe(0);
    expect(overflowCount(10)).toBe(0);
    expect(overflowCount(DEFAULT_MAX_DOTS)).toBe(0);
  });

  it('honours the expanded cap (200 dots → 13 full rows + 1 partial 5-dot row)', () => {
    const days = makeDays(EXPANDED_MAX_DOTS);
    const rows = buildStreakRows(days, EXPANDED_MAX_DOTS);
    // 200 / 15 = 13 remainder 5
    expect(rows.length).toBe(14);
    for (let r = 0; r < 13; r++) {
      expect(rows[r].dots.length).toBe(15);
    }
    expect(rows[13].dots.length).toBe(5);

    // First and last connectors are sane: row 0 winds right, row 13 (last) has no connector.
    expect(rows[0].verticalConnectorSide).toBe('right');
    expect(rows[13].verticalConnectorSide).toBe('none');

    expect(overflowCount(days.length, EXPANDED_MAX_DOTS)).toBe(0);
  });

  it('reports overflow against the expanded cap when total > 200', () => {
    expect(overflowCount(250, EXPANDED_MAX_DOTS)).toBe(50);
    expect(overflowCount(EXPANDED_MAX_DOTS, EXPANDED_MAX_DOTS)).toBe(0);
  });
});
