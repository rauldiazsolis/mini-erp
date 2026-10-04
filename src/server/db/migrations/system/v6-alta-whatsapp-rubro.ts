import type { Migration } from '../types.ts';

/**
 * Alta (#22): el WhatsApp del responsable (solo dígitos) y el rubro del comercio (`kiosco`,
 * `almacen`, `ferreteria` u `otro`). Nulos en los usuarios y comercios que ya existen.
 */
export const v6AltaWhatsappRubro: Migration = {
  version: 6,
  name: 'alta-whatsapp-rubro',
  up: (db) => {
    db.exec(`
ALTER TABLE users ADD COLUMN whatsapp TEXT;
ALTER TABLE tenants ADD COLUMN business_type TEXT;
`);
  },
};
