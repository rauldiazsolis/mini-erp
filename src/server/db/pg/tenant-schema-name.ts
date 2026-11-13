export const SYSTEM_SCHEMA_NAME = 'system';
export const TENANT_SCHEMA_PREFIX = 'tenant_';

/** PostgreSQL corta un identificador a los 63 bytes: un id más largo chocaría con otro comercio. */
const MAX_IDENTIFIER_BYTES = 63;
const TENANT_ID = /^[a-z0-9][a-z0-9_-]*$/;

export class InvalidTenantIdError extends Error {
  constructor(tenantId: string) {
    super(`Id de comercio inválido para un esquema: "${tenantId}"`);
    this.name = 'InvalidTenantIdError';
  }
}

export function isValidTenantId(tenantId: string): boolean {
  return TENANT_ID.test(tenantId) && TENANT_SCHEMA_PREFIX.length + tenantId.length <= MAX_IDENTIFIER_BYTES;
}

/**
 * El esquema de un comercio. Es el único lugar que arma ese nombre: valida el id (minúsculas,
 * dígitos, guiones; el largo que entra en un identificador) para que dos comercios nunca compartan
 * esquema y para que el nombre pueda ir en un `CREATE SCHEMA`.
 */
export function tenantSchemaName(tenantId: string): string {
  if (!isValidTenantId(tenantId)) {
    throw new InvalidTenantIdError(tenantId);
  }
  return `${TENANT_SCHEMA_PREFIX}${tenantId}`;
}
