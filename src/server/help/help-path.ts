const ADMIN_PATH = /^\/admin(\/[a-z0-9._~%-]+)+\/?(\?[^#\s]*)?$/i;

/**
 * La pantalla de un pedido de ayuda (#23): una URL del admin de ese comercio, sin otro origen ni
 * fragmento. Soporte la abre tal cual al tomar el pedido.
 */
export function isAdminPathOf(path: string, tenantSlug: string): boolean {
  if (path.length > 300 || !ADMIN_PATH.test(path)) return false;
  const prefix = `/admin/${encodeURIComponent(tenantSlug)}`;
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}
