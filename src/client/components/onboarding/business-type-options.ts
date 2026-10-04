import { BUSINESS_TYPE_LABELS, type BusinessType } from '../../../shared/business-type.ts';

/** Las tarjetas de rubro del alta y de "Crear nuevo comercio" (#22): el comercio nace vacío. */
export const BUSINESS_TYPE_OPTIONS: readonly { id: BusinessType; title: string; description: string; icon: string }[] = [
  { id: 'kiosco', title: BUSINESS_TYPE_LABELS.kiosco, description: 'Golosinas, bebidas, snacks y cigarrillos.', icon: '🏪' },
  { id: 'almacen', title: BUSINESS_TYPE_LABELS.almacen, description: 'Almacén, lácteos, fiambres y limpieza.', icon: '🛒' },
  { id: 'ferreteria', title: BUSINESS_TYPE_LABELS.ferreteria, description: 'Herramientas, tornillería, pinturas y electricidad.', icon: '🔧' },
  { id: 'otro', title: BUSINESS_TYPE_LABELS.otro, description: 'Cualquier otro rubro.', icon: '🏬' },
];
