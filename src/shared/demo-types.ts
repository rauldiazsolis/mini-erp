/** Un comercio demo en la solapa Demos de la plataforma (#24). */
export type DemoStatusItem = {
  template: string;
  tenantId: string;
  name: string;
  /** Cajas de visitante activas. */
  activeRegisters: number;
  /** Demos creadas hoy (día argentino). */
  createdToday: number;
  /** Ventas de hoy que no son anulación, de todas las cajas. */
  salesToday: number;
  lastFullResetAt: string;
  lastPartialResetAt: string | null;
};

export type DemoResetKind = 'full' | 'partial';

/** `POST /api/platform/demos/reset`: sin rubro, los tres. */
export type DemoResetRequest = { template?: string | undefined; kind: DemoResetKind };

export type DemoResetResponse = { reset: string[]; revoked: number };
