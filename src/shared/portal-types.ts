/** Lo que responde `POST /api/portal/redeem` (#24): la sesión anónima de la demo y dónde abrirla. */
export type PortalRedeemResponse = {
  token: string;
  tenant: { id: string; slug: string; name: string };
  branch: string;
  pointOfSale: string;
  template: string;
};
