import type { Request } from 'express';

/**
 * Un parámetro de la ruta como texto. Express 5 tipa `req.params` como `string | string[]` (un
 * splat llega como arreglo); los `:nombre` de este servidor son siempre texto, y un splat se une con
 * `/`. Sin el parámetro, `undefined`.
 */
export function routeParam(req: Request, name: string): string | undefined {
  const value: string | string[] | undefined = req.params[name];
  return Array.isArray(value) ? value.join('/') : value;
}
