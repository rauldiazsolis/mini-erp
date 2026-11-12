/**
 * El esquema de un comercio (`tenant_<id>`) admite 56 caracteres de id; el slug se corta antes para
 * dejarle lugar al `-2`, `-3` con que desambigua el TenantManager.
 */
export const MAX_SLUG_LENGTH = 48;

/** Identificador del comercio a partir del nombre (#19); el TenantManager desambigua con -2, -3. */
export function slugify(text: string): string {
  const clean = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return clean.length >= 3 ? clean : `comercio${clean === '' ? '' : `-${clean}`}`;
}
