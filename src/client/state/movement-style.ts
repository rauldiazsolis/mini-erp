/** Color de un movimiento del extracto por el signo (#2): positivo sube la deuda, negativo la baja. */
export function movementTone(amount: number): 'debit' | 'credit' | 'neutral' {
  if (amount > 0) return 'debit';
  if (amount < 0) return 'credit';
  return 'neutral';
}

export function movementLabel(type: string): string {
  switch (type) {
    case 'payment':
      return 'Pago / Cobranza';
    case 'payment-void':
      return 'Anulación de cobranza';
    case 'sale':
      return 'Compra en POS (Cuenta Corriente)';
    case 'adjustment':
      return 'Ajuste de saldo';
    case 'interest':
      return 'Interés';
    default: {
      // Un tipo que no conocemos: legible, con mayúscula solo al principio
      const text = type.replace(/_/g, ' ');
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  }
}
