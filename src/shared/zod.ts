// eslint-disable-next-line no-restricted-imports -- el único import directo de Zod (#6)
import { z } from 'zod';

/**
 * Zod con sus mensajes por defecto en castellano (#6). Todo el código importa `z` de acá, así la
 * configuración ya está aplicada antes del primer parse. Los textos propios de cada esquema no cambian.
 * Idioma configurable: #74.
 */
z.config(z.locales.es());

export { z };
