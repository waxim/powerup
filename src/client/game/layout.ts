/**
 * Seat positions around the table, as percentages of the table area. Index 0 is the bottom
 * seat (you), then clockwise: up the left side, across the top, down the right side.
 * Portrait layouts are for phones; landscape for wider screens.
 */
type Point = [number, number];

const PORTRAIT: Record<number, Point[]> = {
  1: [[50, 88]],
  2: [[50, 88], [50, 11]],
  3: [[50, 88], [17, 22], [83, 22]],
  4: [[50, 88], [13, 50], [50, 11], [87, 50]],
  5: [[50, 88], [13, 64], [20, 17], [80, 17], [87, 64]],
  6: [[50, 88], [13, 66], [15, 29], [50, 10], [85, 29], [87, 66]],
};

const LANDSCAPE: Record<number, Point[]> = {
  1: [[50, 87]],
  2: [[50, 87], [50, 12]],
  3: [[50, 87], [18, 20], [82, 20]],
  4: [[50, 87], [9, 50], [50, 12], [91, 50]],
  5: [[50, 87], [11, 66], [24, 14], [76, 14], [89, 66]],
  6: [[50, 87], [9, 66], [17, 19], [50, 11], [83, 19], [91, 66]],
};

const CENTER: Point = [50, 48];

export interface SeatGeometry {
  /** CSS custom properties for the seat and its bet chips, for both orientations. */
  seat: Record<string, number>;
  bet: Record<string, number>;
}

function toward([x, y]: Point, t: number): Point {
  return [x + (CENTER[0] - x) * t, y + (CENTER[1] - y) * t];
}

export function seatGeometry(count: number, index: number): SeatGeometry {
  const n = Math.min(6, Math.max(1, count));
  const p = PORTRAIT[n][index] ?? CENTER;
  const l = LANDSCAPE[n][index] ?? CENTER;
  const pb = toward(p, index === 0 ? 0.36 : 0.46);
  const lb = toward(l, index === 0 ? 0.36 : 0.5);
  return {
    seat: { "--px": p[0], "--py": p[1], "--lx": l[0], "--ly": l[1] },
    bet: { "--px": pb[0], "--py": pb[1], "--lx": lb[0], "--ly": lb[1] },
  };
}
