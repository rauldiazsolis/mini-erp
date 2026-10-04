import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { exampleCatalogSignal, applyExampleCatalog } from '../../state/example-catalog-state.ts';
import { BUSINESS_TYPE_LABELS, hasExampleCatalog } from '../../../shared/business-type.ts';

/** El catálogo de ejemplo del rubro (#22), mientras el comercio no tenga productos. */
export function ExampleCatalogCard() {
  const status = exampleCatalogSignal.value;
  if (status === null || !status.available || !hasExampleCatalog(status.businessType)) return null;
  const rubro = BUSINESS_TYPE_LABELS[status.businessType];

  return (
    <Card class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-bold text-slate-900 dark:text-white">{`¿Empezás con el catálogo de ejemplo de ${rubro}?`}</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Tu comercio todavía no tiene productos. Lo corregís después: precios, nombres y stock.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          void applyExampleCatalog();
        }}
      >
        Cargar el catálogo de ejemplo
      </Button>
    </Card>
  );
}
