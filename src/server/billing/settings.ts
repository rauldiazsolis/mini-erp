import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
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
export function readBillingSettings(db: DatabaseSync): BillingSettings {
  const rows = db.prepare('SELECT key, value FROM billing_settings').all() as { key: string; value: string }[];
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

export function writeBillingSettings(db: DatabaseSync, patch: BillingSettingsPatch, userId: string, at: string): BillingSettings {
  const upsert = db.prepare(
    `INSERT INTO billing_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) upsert.run(key, JSON.stringify(value), userId, at);
  }
  return readBillingSettings(db);
}
