/** El WhatsApp del responsable en el alta (#22): validación laxa, sin verificar por mensaje. */
export const WHATSAPP_MESSAGE = 'Escribí un WhatsApp con código de área (8 a 15 números)';

/** Solo los dígitos (sin espacios, guiones, puntos, paréntesis ni `+`), entre 8 y 15; si no, `undefined`. */
export function normalizeWhatsapp(raw: string): string | undefined {
  const digits = raw.replace(/[\s\-().+]/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : undefined;
}
