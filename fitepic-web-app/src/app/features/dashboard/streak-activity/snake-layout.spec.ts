import { DayActivityRecordResponse } from '../../../core/api/generated/models/day-activity-record-response';
import { MAX_DOTS, buildStreakRows, overflowCount } from './snake-layout';

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

  it('handles exactly 44 days (cap exactly hit, no overflow)', () => {
    const days = makeDays(44);
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

    // row 2: even (kept), 14 dots, day-30 on left, day-43 on right, no connector (last)
    expect(rows[2].dots.length).toBe(14);
    expect(rows[2].dots[0].date).toBe('day-30');
    expect(rows[2].dots[13].date).toBe('day-43');
    expect(rows[2].verticalConnectorSide).toBe('none');

    expect(overflowCount(days.length)).toBe(0);
  });

  it('caps to 44 dots and reports the overflow (45 days → overflow 1)', () => {
    const days = makeDays(45);
    const rows = buildStreakRows(days);
    expect(rows.length).toBe(3);
    expect(rows[0].dots.length + rows[1].dots.length + rows[2].dots.length).toBe(MAX_DOTS);
    expect(overflowCount(days.length)).toBe(1);
  });

  it('caps to 44 dots and reports the overflow (90 days → overflow 46)', () => {
    const days = makeDays(90);
    const rows = buildStreakRows(days);
    expect(rows.length).toBe(3);
    expect(rows[0].dots.length + rows[1].dots.length + rows[2].dots.length).toBe(MAX_DOTS);
    // 90 - 44 = 46
    expect(overflowCount(days.length)).toBe(46);
  });

  it('overflowCount never goes negative', () => {
    expect(overflowCount(0)).toBe(0);
    expect(overflowCount(10)).toBe(0);
    expect(overflowCount(44)).toBe(0);
  });
});
