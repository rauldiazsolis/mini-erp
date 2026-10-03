import type { BusinessPreset } from './types.ts';
import type { DemoTemplate } from './index.ts';

/**
 * Datos del seed de desarrollo (#21): usuarios de cada rol, un comercio por rubro con su estado de
 * créditos y un par de demos. Todo está en el repo: nunca se siembra en producción.
 */

/** La contraseña de todos los usuarios de desarrollo. */
export const DEV_PASSWORD = 'admin123';

export type DevUserKey = 'root' | 'support' | 'ownerA' | 'ownerB' | 'adminK' | 'memberK';

export const DEV_USERS: Record<DevUserKey, { email: string; name: string }> = {
  root: { email: 'root@local.test', name: 'Root Dev' },
  support: { email: 'soporte@local.test', name: 'Soporte Dev' },
  ownerA: { email: 'dueno-a@local.test', name: 'Dueño A' },
  ownerB: { email: 'dueno-b@local.test', name: 'Dueño B' },
  adminK: { email: 'admin-k@local.test', name: 'Admin del Kiosco' },
  memberK: { email: 'empleado-k@local.test', name: 'Empleado del Kiosco' },
};

/** El estado de créditos que muestra el comercio sembrado (ver `seedCredits` en `db/dev-seed.ts`). */
export type DevCreditsScenario = 'ok' | 'low' | 'debt';

export type DevRegister = {
  id: string;
  keyId: string;
  name: string;
  pointOfSale: string;
  /** Key fija, para conectar un POS de desarrollo a esa caja. */
  rawKey: string;
  /** Días de historial de ventas de la caja, hasta hoy. */
  historyDays: number;
};

export type DevTenant = {
  id: string;
  name: string;
  preset: BusinessPreset;
  owner: DevUserKey;
  /** Admins y empleados además del owner. */
  staff: { user: DevUserKey; role: 'admin' | 'member' }[];
  credits: DevCreditsScenario;
  registers: DevRegister[];
};

export const DEV_BRANCH = 'CENTRAL';

/** La key de siempre del POS de desarrollo: Caja 1 del Kiosco. */
export const DEV_POS_API_KEY = 'mpos_dev_demo_key_12345';

/** En este orden: Kiosco y Almacén comparten titular y el Almacén usa lo que el Kiosco dejó de saldo pagado. */
export const DEV_TENANTS: DevTenant[] = [
  {
    id: 'kiosco-don-pepe',
    name: 'Kiosco Don Pepe',
    preset: 'kiosco',
    owner: 'ownerA',
    staff: [
      { user: 'adminK', role: 'admin' },
      { user: 'memberK', role: 'member' },
    ],
    credits: 'ok',
    registers: [
      // Los ids de la key de desarrollo de siempre (los mismos que le daba la migración de sistema v5)
      { id: 'reg_key_dev_default', keyId: 'key_dev_default', name: 'Caja 1', pointOfSale: 'Caja 1', rawKey: DEV_POS_API_KEY, historyDays: 30 },
      { id: 'reg_dev_kiosco_2', keyId: 'key_dev_kiosco_2', name: 'Caja 2', pointOfSale: 'Caja 2', rawKey: 'mpos_dev_kiosco_caja2', historyDays: 10 },
    ],
  },
  {
    id: 'almacen-la-esquina',
    name: 'Almacén La Esquina',
    preset: 'almacen',
    owner: 'ownerA',
    staff: [],
    credits: 'low',
    registers: [
      { id: 'reg_dev_almacen_1', keyId: 'key_dev_almacen_1', name: 'Caja 1', pointOfSale: 'Caja 1', rawKey: 'mpos_dev_almacen_caja1', historyDays: 30 },
    ],
  },
  {
    id: 'ferreteria-el-tornillo',
    name: 'Ferretería El Tornillo',
    preset: 'ferreteria',
    owner: 'ownerB',
    staff: [],
    credits: 'debt',
    registers: [
      { id: 'reg_dev_ferreteria_1', keyId: 'key_dev_ferreteria_1', name: 'Caja 1', pointOfSale: 'Caja 1', rawKey: 'mpos_dev_ferreteria_caja1', historyDays: 30 },
    ],
  },
];

/** Demos andando, con key fija. Si vencieron, el arranque las vuelve a crear. */
export const DEV_DEMOS: { template: DemoTemplate; rawKey: string }[] = [
  { template: 'kiosco', rawKey: 'mpos_dev_demo_kiosco' },
  { template: 'almacen', rawKey: 'mpos_dev_demo_almacen' },
];
