export function quote(seats: number): number {
  const base = 49;
  return seats > 100 ? seats * base * 0.7 : seats * base;
}
