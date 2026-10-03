import { applyPreset, rangePresetSignal, rangeSignal, registerSignal, registersSignal, setCustomRange, setRegister, type RangePreset } from '../../state/sales-state.ts';
import { parseRegisterKey, registerKey, registerLabel } from '../../state/sales-labels.ts';
import { Button } from '../ui/Button.tsx';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Input } from '../ui/Input.tsx';
import { Select } from '../ui/Select.tsx';

const PRESETS: Array<{ id: Exclude<RangePreset, 'custom'>; label: string }> = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'week', label: '7 días' },
  { id: 'month', label: '30 días' },
];

/** Rango de días y caja: compartidos por las cuatro solapas. */
export function SalesRangeBar() {
  const preset = rangePresetSignal.value;
  const range = rangeSignal.value;
  const current = registerKey(registerSignal.value);
  const options = registersSignal.value.map((r) => ({
    key: registerKey({ branch: r.branch ?? '', pointOfSale: r.pointOfSale ?? '' }),
    label: registerLabel(r.branch, r.pointOfSale),
  }));
  // El drill-down puede filtrar solo por sucursal: se ofrece como opción para que el select lo muestre
  const branchOnly = registerSignal.value.branch;
  if (current !== '' && !options.some((o) => o.key === current) && branchOnly !== undefined) {
    options.unshift({ key: current, label: `${branchOnly} · todas las cajas` });
  }

  return (
    <FilterToolbar>
      <div class="flex flex-col lg:flex-row lg:items-end gap-3">
        <div class="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant={preset === p.id ? 'primary' : 'secondary'} onClick={() => { applyPreset(p.id); }}>
              {p.label}
            </Button>
          ))}
        </div>
        <div class="grid grid-cols-2 gap-3 lg:w-80">
          <Input type="date" label="Desde" value={range.from} onChange={(e) => { setCustomRange({ from: e.currentTarget.value, to: range.to }); }} />
          <Input type="date" label="Hasta" value={range.to} onChange={(e) => { setCustomRange({ from: range.from, to: e.currentTarget.value }); }} />
        </div>
        <div class="lg:w-64">
          <Select label="Caja" value={current} onChange={(e) => { setRegister(parseRegisterKey(e.currentTarget.value)); }}>
            <option value="">Todas las cajas</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </FilterToolbar>
  );
}
