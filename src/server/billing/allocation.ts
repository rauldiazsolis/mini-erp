/** El remanente vigente de un crédito regalado, en el orden en que se consume (vencimiento más próximo primero). */
export type GiftBalance = { creditId: string; remaining: number };

export type Allocation = { paid: number; gifts: { creditId: string; amount: number }[]; debt: number };

/**
 * Reparte un cargo (#21): con pagado > 0, la proporción; el faltante de una fuente sale de la otra;
 * con pagado en 0, todo regalado; lo que no cubre ninguna es deuda. Pesos enteros: la parte pagada
 * se redondea y el regalado completa.
 */
export function allocateCharge(p: { price: number; paidShare: number; paidBalance: number; gifts: readonly GiftBalance[] }): Allocation {
  const giftTotal = p.gifts.reduce((sum, gift) => sum + Math.max(0, gift.remaining), 0);
  const available = Math.max(0, p.paidBalance);
  const wanted = available > 0 ? Math.round(p.price * p.paidShare) : 0;
  let paid = Math.min(wanted, available);
  const giftPart = Math.min(p.price - paid, giftTotal);
  paid += Math.min(p.price - paid - giftPart, available - paid);
  const debt = p.price - paid - giftPart;

  const gifts: { creditId: string; amount: number }[] = [];
  let left = giftPart;
  for (const gift of p.gifts) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, gift.remaining));
    if (take > 0) {
      gifts.push({ creditId: gift.creditId, amount: take });
      left -= take;
    }
  }
  return { paid, gifts, debt };
}
