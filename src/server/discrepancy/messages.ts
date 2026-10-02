export type DiscrepancyKind = 'unknown-customer' | 'void-unknown-payment' | 'void-customer-mismatch' | 'void-duplicate';
export type DiscrepancyRefType = 'sale' | 'customer-payment';

const pesos = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** Texto para la persona de la caja y para el admin (#2). */
export function discrepancyMessage(d: { kind: DiscrepancyKind; refType: DiscrepancyRefType; amount: number }): string {
  const monto = `$${pesos.format(Math.abs(d.amount))}`;
  switch (d.kind) {
    case 'unknown-customer':
      return d.refType === 'sale'
        ? `La venta a cuenta de ${monto} es de un cliente que mini contax todavía no tiene: se suma a su saldo cuando llegue el cliente.`
        : `La cobranza de ${monto} es de un cliente que mini contax todavía no tiene: se descuenta de su saldo cuando llegue el cliente.`;
    case 'void-unknown-payment':
      return `Se anuló una cobranza que mini contax no tiene registrada (${monto}): revisalo en mini contax.`;
    case 'void-customer-mismatch':
      return `Se anuló una cobranza de otro cliente (${monto}): revisalo en mini contax.`;
    case 'void-duplicate':
      return `Esa cobranza ya estaba anulada y se volvió a anular (${monto}): revisalo en mini contax.`;
  }
}
