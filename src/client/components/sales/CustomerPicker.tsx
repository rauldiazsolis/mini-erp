import { customersSignal } from '../../state/customer-state.ts';
import { Input } from '../ui/Input.tsx';

/** Cliente con búsqueda (datalist sobre los clientes que ya carga Clientes); vacío es "todos". */
export function CustomerPicker(props: { id: string; value: string | undefined; onChange: (customerId: string | undefined) => void }) {
  const customers = customersSignal.value;
  const selected = customers.find((c) => c.id === props.value);
  return (
    <div>
      <Input
        label="Cliente"
        list={props.id}
        placeholder="Todos"
        value={selected?.name ?? props.value ?? ''}
        onChange={(e) => {
          const name = e.currentTarget.value.trim();
          props.onChange(name === '' ? undefined : customers.find((c) => c.name === name)?.id);
        }}
      />
      <datalist id={props.id}>
        {customers.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
    </div>
  );
}
