/** El embudo de M9 (#25): eventos, totales del landing, contactos, etapas y lo que devuelve el panel. */

export const FUNNEL_EVENT_TYPES = ['demo-sale', 'portal-opened', 'alta-opened', 'catalog-loaded'] as const;
export type FunnelEventType = (typeof FUNNEL_EVENT_TYPES)[number];

/** Totales anónimos por día argentino: el landing y las altas abiertas sin demo. */
export const FUNNEL_DAILY_KINDS = ['landing', 'demo-click', 'alta-open'] as const;
export type FunnelDailyKind = (typeof FUNNEL_DAILY_KINDS)[number];

export const FUNNEL_CONTACT_SOURCES = ['demo', 'demo-ended', 'landing'] as const;
export type FunnelContactSource = (typeof FUNNEL_CONTACT_SOURCES)[number];

export const FUNNEL_STAGES = ['demo', 'demo-sale', 'portal', 'contact', 'alta', 'commerce', 'load', 'real-sale', 'payment'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  demo: 'Demo',
  'demo-sale': 'Venta demo',
  portal: 'Mini desde el POS',
  contact: 'Contacto',
  alta: 'Alta',
  commerce: 'Comercio',
  load: 'Carga',
  'real-sale': 'Venta real',
  payment: 'Pago',
};

/** El rubro de un visitante: el de su demo o el de su comercio; `otro` también es "sin rubro". */
export const FUNNEL_RUBROS = ['kiosco', 'almacen', 'ferreteria', 'otro'] as const;
export type FunnelRubro = (typeof FUNNEL_RUBROS)[number];

export const FUNNEL_RUBRO_LABELS: Record<FunnelRubro, string> = {
  kiosco: 'Kiosco',
  almacen: 'Almacén',
  ferreteria: 'Ferretería',
  otro: 'Otro o sin rubro',
};

export const FUNNEL_VISITOR_FILTERS = ['all', 'contact', 'pending', 'alta'] as const;
export type FunnelVisitorFilter = (typeof FUNNEL_VISITOR_FILTERS)[number];

export function isFunnelRubro(value: string | null | undefined): value is FunnelRubro {
  return (FUNNEL_RUBROS as readonly (string | null | undefined)[]).includes(value);
}

export function isFunnelDailyKind(value: string): value is FunnelDailyKind {
  return (FUNNEL_DAILY_KINDS as readonly string[]).includes(value);
}

export function isFunnelContactSource(value: string): value is FunnelContactSource {
  return (FUNNEL_CONTACT_SOURCES as readonly string[]).includes(value);
}

export type FunnelReport = {
  from: string;
  to: string;
  landing: Record<FunnelDailyKind, number>;
  stages: { stage: FunnelStage; total: number; byRubro: Record<FunnelRubro, number> }[];
};

export type FunnelContactInfo = {
  id: string;
  name: string | null;
  whatsapp: string | null;
  source: FunnelContactSource;
  createdAt: string;
  handledAt: string | null;
  handledByName: string | null;
  erased: boolean;
};

export type FunnelVisitorItem = {
  /** El id de la demo, `c-<contacto>` o `t-<comercio>`. */
  id: string;
  startedAt: string;
  rubro: FunnelRubro;
  furthest: FunnelStage;
  pointOfSale: string | null;
  contact: FunnelContactInfo | null;
  tenant: { id: string; slug: string; name: string } | null;
};

export type FunnelVisitorList = { from: string | null; to: string | null; items: FunnelVisitorItem[] };

export type FunnelVisitorDetail = FunnelVisitorItem & {
  stages: { stage: FunnelStage; at: string | null }[];
  demo: { template: string; pointOfSale: string | null; createdAt: string; revokedAt: string | null; revokeReason: string | null } | null;
  holder: { name: string; accountCreatedAt: string } | null;
  loadSource: string | null;
};
