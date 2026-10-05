export type PortalTenant = { id: string; slug: string; name: string };

/**
 * Lo que responde `POST /api/portal/redeem`: la sesión anónima y dónde abrirla. Una demo (#24) lleva
 * el rubro; una caja real (M10) lleva su nombre.
 */
export type PortalRedeemResponse =
  | { access: 'demo'; token: string; tenant: PortalTenant; branch: string; pointOfSale: string; template: string }
  | { access: 'register'; token: string; tenant: PortalTenant; branch: string; pointOfSale: string; registerName: string };
