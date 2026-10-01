import pkg from '../../package.json' with { type: 'json' };

/**
 * La versión de mini: la de package.json, única fuente (#40). La informan `/health` y
 * `GET /connector/info`, la muestra el cliente y el deploy la compara con el tag.
 */
export const APP_VERSION: string = pkg.version;
