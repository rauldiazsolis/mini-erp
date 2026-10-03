/** Una caja del POS (#21): sucursal + punto de venta, con su equipo ligado y su key activa. */
export type RegisterDevice = { deviceId: string; firstSeenAt: string; lastSeenAt: string };

export type RegisterItem = {
  id: string;
  name: string;
  branch: string;
  pointOfSale: string;
  active: boolean;
  deviceId: string | null;
  boundAt: string | null;
  lastSeenAt: string | null;
  keyPrefix: string | null;
  createdAt: string;
  /** Equipos que usaron la key desde que se ligó la caja, sin el ligado. */
  otherDevices: RegisterDevice[];
};

/** Lo que los avisos del pull necesitan de la caja de una terminal. */
export type RegisterNoticeState = {
  registerId: string;
  binding: 'bound' | 'foreign';
  /** Para el equipo ligado: si otro usó la key en los últimos 7 días. */
  sharedRecently: boolean;
};
