// How far apart two tower states are (metres): the largest movement of any floor.
export const isTower = (v) => Array.isArray(v?.floors);

export function towerDistance(a, b) {
  if (a.floors.length !== b.floors.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.floors.length; i++) {
    const p = a.floors[i];
    const q = b.floors[i];
    const r = Math.max(p.w, p.d, q.w, q.d) / 2;
    m = Math.max(
      m,
      Math.abs(p.w - q.w),
      Math.abs(p.d - q.d),
      Math.abs(p.cx - q.cx),
      Math.abs(p.cy - q.cy),
      Math.abs(p.rot - q.rot) * r,
      Math.abs((p.round ?? 0) - (q.round ?? 0)) * r,
    );
  }
  return m;
}
