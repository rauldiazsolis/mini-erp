/** El rubro del comercio (#22): elige el catálogo de ejemplo y sirve para el embudo (M8). */
export const BUSINESS_TYPES = ['kiosco', 'almacen', 'ferreteria', 'otro'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
/** Los rubros con catálogo de ejemplo (los presets de `src/server/seeds/`). */
export type ExampleCatalog = Exclude<BusinessType, 'otro'>;

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  kiosco: 'Kiosco',
  almacen: 'Almacén',
  ferreteria: 'Ferretería',
  otro: 'Otro',
};

export function isBusinessType(value: string): value is BusinessType {
  return BUSINESS_TYPES.some((t) => t === value);
}

export function hasExampleCatalog(type: BusinessType | null): type is ExampleCatalog {
  return type !== null && type !== 'otro';
}
