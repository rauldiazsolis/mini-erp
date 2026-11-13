import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { z } from '../../shared/zod.ts';
import type { BillingSettings } from '../../shared/credits-types.ts';

export type { BillingSettings };

/** Configuración de cobro (#21), solo para root. Los valores por defecto viven acá; la base guarda los cambios. */
export const billingSettingsSchema = z.object({
  pricePerRegisterDay: z.number().int().positive(),
  signupBonus: z.number().int().min(0),
  signupBonusDays: z.number().int().positive(),
  paidShare: z.number().min(0).max(1),
  graceDays: z.number().int().min(0),
  lowBalanceDays: z.number().int().min(0),
  paymentAlias: z.string().trim().max(100),
  paymentCbu: z.string().trim().max(30),
  paymentHolder: z.string().trim().max(100),
  supportWhatsapp: z.string().trim().max(30),
}) satisfies z.ZodType<BillingSettings>;

export const billingSettingsPatchSchema = billingSettingsSchema.partial().strict();
export type BillingSettingsPatch = z.infer<typeof billingSettingsPatchSchema>;

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  pricePerRegisterDay: 1000,
  signupBonus: 50000,
  signupBonusDays: 90,
  paidShare: 0.5,
  graceDays: 10,
  lowBalanceDays: 7,
  paymentAlias: '',
  paymentCbu: '',
  paymentHolder: '',
  supportWhatsapp: '',
};

const KEYS = Object.keys(DEFAULT_BILLING_SETTINGS);

/** Lo guardado sobre los valores por defecto; un valor guardado que no valida se ignora. */
export async function readBillingSettings(db: Kysely<SystemDatabase>): Promise<BillingSettings> {
  const rows = await db.selectFrom('billing_settings').select(['key', 'value']).execute();
  const merged: Record<string, unknown> = { ...DEFAULT_BILLING_SETTINGS };
  for (const row of rows) {
    if (!KEYS.includes(row.key)) continue;
    const candidate = { ...merged, [row.key]: JSON.parse(row.value) as unknown };
    if (billingSettingsSchema.safeParse(candidate).success) {
      merged[row.key] = candidate[row.key];
    }
  }
  return billingSettingsSchema.parse(merged);
}

export async function writeBillingSettings(db: Kysely<SystemDatabase>, patch: BillingSettingsPatch, userId: string, at: string): Promise<BillingSettings> {
  const rows = Object.entries(patch).flatMap(([key, value]) =>
    value === undefined ? [] : [{ key, value: JSON.stringify(value), updated_by: userId, updated_at: at }],
  );
  if (rows.length > 0) {
    await db
      .insertInto('billing_settings')
      .values(rows)
      .onConflict((oc) =>
        oc.column('key').doUpdateSet((eb) => ({
          value: eb.ref('excluded.value'),
          updated_by: eb.ref('excluded.updated_by'),
          updated_at: eb.ref('excluded.updated_at'),
        })),
      )
      .execute();
  }
  return await readBillingSettings(db);
}
