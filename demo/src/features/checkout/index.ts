export type SavedCard = { id: string; last4: string };

export function canOneClickPay(cards: SavedCard[]): boolean {
  return cards.length > 0;
}
