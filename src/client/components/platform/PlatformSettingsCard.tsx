import { signal } from '@preact/signals';
import {
  platformSettingsSignal,
  savePlatformSettings,
  settingsToDraft,
  draftToSettings,
  type SettingsDraft,
} from '../../state/platform-state.ts';
import { Card, CardHeader } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';

/** Lo que se está editando; `null` muestra lo guardado. */
const draftSignal = signal<SettingsDraft | null>(null);
const errorSignal = signal<string | null>(null);
const savingSignal = signal<boolean>(false);

type Field = { key: keyof SettingsDraft; label: string; helper?: string; numeric: boolean };

const FIELDS: Field[] = [
  { key: 'pricePerRegisterDay', label: 'Precio por caja y día', helper: 'Se cobra solo los días que la caja vende', numeric: true },
  { key: 'signupBonus', label: 'Bono de alta', helper: 'Créditos regalados al crear un comercio', numeric: true },
  { key: 'signupBonusDays', label: 'Días del bono', helper: 'Hasta cuándo vale el bono de alta', numeric: true },
  { key: 'paidShare', label: 'Porcentaje pagado (0 a 100 %)', helper: 'Qué parte de cada cargo sale del saldo pagado mientras haya', numeric: true },
  { key: 'graceDays', label: 'Días de gracia', helper: 'Con deuda, cuánto falta para restringir el admin', numeric: true },
  { key: 'lowBalanceDays', label: 'Días del aviso', helper: 'Avisa cuando el saldo alcanza para menos días', numeric: true },
  { key: 'paymentAlias', label: 'Alias', numeric: false },
  { key: 'paymentCbu', label: 'CBU', numeric: false },
  { key: 'paymentHolder', label: 'Titular de la cuenta', numeric: false },
  { key: 'supportWhatsapp', label: 'WhatsApp de soporte', helper: 'Con código de país, por ejemplo +54 9 11 5555-1234', numeric: false },
];

async function save(draft: SettingsDraft): Promise<void> {
  const settings = draftToSettings(draft);
  if (typeof settings === 'string') {
    errorSignal.value = settings;
    return;
  }
  errorSignal.value = null;
  savingSignal.value = true;
  const ok = await savePlatformSettings(settings);
  savingSignal.value = false;
  if (ok) draftSignal.value = null;
}

/** Configuración de cobro (#21), solo para root: precios, bono, gracia y cómo pagar. */
export function PlatformSettingsCard() {
  const saved = platformSettingsSignal.value;
  if (saved === null) {
    return <Card class="text-sm text-slate-500 dark:text-slate-400">Cargando configuración…</Card>;
  }
  const draft = draftSignal.value ?? settingsToDraft(saved);
  const error = errorSignal.value;
  return (
    <Card>
      <CardHeader title="Configuración de cobro" description="Los cambios valen para los cargos nuevos; los ya hechos no se recalculan." />
      <form
        class="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft);
        }}
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <Input
              key={f.key}
              id={`platform-${f.key}`}
              label={f.label}
              {...(f.helper === undefined ? {} : { helperText: f.helper })}
              type={f.numeric ? 'number' : 'text'}
              {...(f.numeric ? { min: '0', step: 'any' } : {})}
              value={draft[f.key]}
              onInput={(e) => {
                draftSignal.value = { ...draft, [f.key]: e.currentTarget.value };
              }}
            />
          ))}
        </div>
        {error !== null && <p class="text-xs text-rose-500 dark:text-rose-400 font-medium">{error}</p>}
        <div class="flex justify-end gap-2">
          {draftSignal.value !== null && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                draftSignal.value = null;
                errorSignal.value = null;
              }}
            >
              Descartar cambios
            </Button>
          )}
          <Button type="submit" loading={savingSignal.value}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}
