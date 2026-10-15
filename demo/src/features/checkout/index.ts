export type SavedCard = { id: string; last4: string };

export function canOneClickPay(cards: SavedCard[]): boolean {
  return cards.length > 0;
}

export function defaultCard(cards: SavedCard[]): SavedCard | undefined {
  return cards[0];
}

export function cardLabel(card: SavedCard): string {
  return `•••• ${card.last4}`;
}
