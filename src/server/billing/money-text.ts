/**
 * Textos fijos del servidor para los avisos del POS (#21): el servidor no conoce el navegador de
 * quien los lee, así que los importes van como `$ 12.345` y las fechas como `DD/MM`.
 */
const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export function formatPesos(n: number): string {
  return `$ ${PESOS.format(Math.round(n))}`;
}

export function formatDayShort(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}
