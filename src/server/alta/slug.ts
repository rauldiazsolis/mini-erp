/** Identificador del comercio a partir del nombre (#19); el TenantManager desambigua con -2, -3. */
export function slugify(text: string): string {
  const clean = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean.length >= 3 ? clean : `comercio${clean === '' ? '' : `-${clean}`}`;
}
