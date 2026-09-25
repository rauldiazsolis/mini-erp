import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';

export type CustomerItem = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  creditLimit: number;
  margin: number;
  balance: number;
  availableCredit: number | null;
  unrestricted: boolean;
  isDebtor: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountMovementItem = {
  id: string;
  customerId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  saleId: string | null;
  createdAt: string;
};

export type CustomerFormData = {
  id?: string;
  name: string;
  document: string;
  phone: string;
  creditLimit: number;
  margin: number;
  unrestricted: boolean;
  initialBalance: number;
  blockedReason?: string | null;
};

export type PaymentFormData = {
  amount: number;
  method: string;
  reference: string;
  description: string;
};

export type BalanceAdjustFormData = {
  type: 'credit' | 'debit' | 'set';
  amount: number;
  reason: string;
};

// Señales principales
export const customersSignal = signal<CustomerItem[]>([]);
export const customerLoadingSignal = signal<boolean>(false);
export const customerErrorSignal = signal<string | null>(null);

// Filtros
export const customerSearchSignal = signal<string>('');
export const customerDebtorsOnlySignal = signal<boolean>(false);
export const customerBlockedFilterSignal = signal<'all' | 'active' | 'blocked'>('all');

// Modal de Alta / Edición
export const customerModalOpenSignal = signal<boolean>(false);
export const editingCustomerSignal = signal<CustomerItem | null>(null);
export const customerFormDataSignal = signal<CustomerFormData>({
  name: '',
  document: '',
  phone: '',
  creditLimit: 50000,
  margin: 10000,
  unrestricted: false,
  initialBalance: 0,
});
export const isSavingCustomerSignal = signal<boolean>(false);
export const customerFormErrorSignal = signal<string | null>(null);

// Modal de Cobranza Manual
export const paymentModalOpenSignal = signal<boolean>(false);
export const paymentTargetCustomerSignal = signal<CustomerItem | null>(null);
export const paymentFormDataSignal = signal<PaymentFormData>({
  amount: 0,
  method: 'efectivo',
  reference: '',
  description: 'Cobranza en cuenta corriente',
});
export const isSubmittingPaymentSignal = signal<boolean>(false);
export const paymentErrorSignal = signal<string | null>(null);

// Modal de Ajuste de Saldo
export const balanceAdjustModalOpenSignal = signal<boolean>(false);
export const balanceAdjustTargetSignal = signal<CustomerItem | null>(null);
export const balanceAdjustFormSignal = signal<BalanceAdjustFormData>({
  type: 'credit',
  amount: 0,
  reason: 'bonificacion',
});
export const isSubmittingAdjustSignal = signal<boolean>(false);
export const balanceAdjustErrorSignal = signal<string | null>(null);

// Drawer de Extracto de Cuenta Corriente
export const accountDrawerOpenSignal = signal<boolean>(false);
export const accountTargetCustomerSignal = signal<CustomerItem | null>(null);
export const accountMovementsSignal = signal<AccountMovementItem[]>([]);
export const accountLoadingSignal = signal<boolean>(false);

// Clientes Filtrados
export const filteredCustomersSignal = computed<CustomerItem[]>(() => {
  const search = customerSearchSignal.value.trim().toLowerCase();
  const debtorsOnly = customerDebtorsOnlySignal.value;
  const blockedFilter = customerBlockedFilterSignal.value;

  return customersSignal.value.filter((c) => {
    if (search) {
      const matchName = c.name.toLowerCase().includes(search);
      const matchDoc = c.document?.toLowerCase().includes(search) ?? false;
      const matchPhone = c.phone?.toLowerCase().includes(search) ?? false;
      if (!matchName && !matchDoc && !matchPhone) return false;
    }

    if (debtorsOnly && !c.isDebtor && c.balance <= 0) {
      return false;
    }

    if (blockedFilter === 'active' && c.blockedReason !== null) {
      return false;
    }
    if (blockedFilter === 'blocked' && c.blockedReason === null) {
      return false;
    }

    return true;
  });
});

// Métricas de Clientes y Deuda
export const customerStatsSignal = computed(() => {
  const all = customersSignal.value;
  let totalDebtors = 0;
  let totalDebtAmount = 0;

  for (const c of all) {
    if (c.balance > 0) {
      totalDebtors++;
      totalDebtAmount += c.balance;
    }
  }

  return {
    totalCustomers: all.length,
    totalDebtors,
    totalDebtAmount,
  };
});

export async function fetchCustomers(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    customerLoadingSignal.value = true;
    customerErrorSignal.value = null;

    const data = await apiFetch<CustomerItem[]>(`tenants/${tenantId}/customers`, { token });
    customersSignal.value = data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cargar clientes';
    customerErrorSignal.value = msg;
    showToast({ type: 'error', title: 'Error de clientes', message: msg });
  } finally {
    customerLoadingSignal.value = false;
  }
}

// Modal Alta / Edición
export function openNewCustomerModal(): void {
  editingCustomerSignal.value = null;
  customerFormDataSignal.value = {
    name: '',
    document: '',
    phone: '',
    creditLimit: 50000,
    margin: 10000,
    unrestricted: false,
    initialBalance: 0,
  };
  customerFormErrorSignal.value = null;
  customerModalOpenSignal.value = true;
}

export function openEditCustomerModal(customer: CustomerItem): void {
  editingCustomerSignal.value = customer;
  customerFormDataSignal.value = {
    id: customer.id,
    name: customer.name,
    document: customer.document ?? '',
    phone: customer.phone ?? '',
    creditLimit: customer.creditLimit,
    margin: customer.margin,
    unrestricted: customer.unrestricted,
    initialBalance: 0,
    blockedReason: customer.blockedReason,
  };
  customerFormErrorSignal.value = null;
  customerModalOpenSignal.value = true;
}

export function closeCustomerModal(): void {
  customerModalOpenSignal.value = false;
  editingCustomerSignal.value = null;
  customerFormErrorSignal.value = null;
}

export async function submitCustomerForm(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  const data = customerFormDataSignal.value;
  if (!data.name.trim()) {
    customerFormErrorSignal.value = 'El nombre o razón social es requerido';
    return;
  }

  try {
    isSavingCustomerSignal.value = true;
    customerFormErrorSignal.value = null;

    const isEdit = Boolean(editingCustomerSignal.value);
    const endpoint = isEdit
      ? `tenants/${tenantId}/customers/${editingCustomerSignal.value!.id}`
      : `tenants/${tenantId}/customers`;

    const payload = {
      name: data.name.trim(),
      document: data.document.trim() || null,
      phone: data.phone.trim() || null,
      creditLimit: data.creditLimit,
      margin: data.margin,
      unrestricted: data.unrestricted,
      initialBalance: !isEdit && data.initialBalance ? data.initialBalance : undefined,
    };

    const saved = await apiFetch<CustomerItem>(endpoint, {
      method: isEdit ? 'PUT' : 'POST',
      body: payload,
      token,
    });

    if (isEdit) {
      customersSignal.value = customersSignal.value.map((c) => (c.id === saved.id ? saved : c));
      showToast({
        type: 'success',
        title: 'Cliente Modificado',
        message: `"${saved.name}" actualizado correctamente`,
      });
    } else {
      customersSignal.value = [saved, ...customersSignal.value];
      showToast({
        type: 'success',
        title: 'Cliente Creado',
        message: `"${saved.name}" registrado con éxito`,
      });
    }

    closeCustomerModal();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al guardar cliente';
    customerFormErrorSignal.value = msg;
  } finally {
    isSavingCustomerSignal.value = false;
  }
}

// Cobranza Manual
export function openPaymentModal(customer: CustomerItem): void {
  paymentTargetCustomerSignal.value = customer;
  paymentFormDataSignal.value = {
    amount: customer.balance > 0 ? customer.balance : 0,
    method: 'efectivo',
    reference: '',
    description: 'Cobranza en cuenta corriente',
  };
  paymentErrorSignal.value = null;
  paymentModalOpenSignal.value = true;
}

export function closePaymentModal(): void {
  paymentModalOpenSignal.value = false;
  paymentTargetCustomerSignal.value = null;
  paymentErrorSignal.value = null;
}

export async function submitPayment(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  const target = paymentTargetCustomerSignal.value;
  if (!tenantId || !token || !target) return;

  const form = paymentFormDataSignal.value;
  if (form.amount <= 0 || isNaN(form.amount)) {
    paymentErrorSignal.value = 'El importe a cobrar debe ser mayor a 0';
    return;
  }

  try {
    isSubmittingPaymentSignal.value = true;
    paymentErrorSignal.value = null;

    const res = await apiFetch<{
      customerId: string;
      previousBalance: number;
      amount: number;
      newBalance: number;
      movementId: string;
    }>(`tenants/${tenantId}/customers/${target.id}/payments`, {
      method: 'POST',
      body: {
        amount: form.amount,
        method: form.method,
        reference: form.reference.trim() || undefined,
        description: form.description.trim() || undefined,
      },
      token,
    });

    // Actualizar reactivamente el balance del cliente en memoria
    customersSignal.value = customersSignal.value.map((c) => {
      if (c.id === target.id) {
        const isDebtor = res.newBalance > 0;
        const availableCredit = c.unrestricted ? null : Math.max(0, c.creditLimit + c.margin - res.newBalance);
        return {
          ...c,
          balance: res.newBalance,
          isDebtor,
          availableCredit,
        };
      }
      return c;
    });

    showToast({
      type: 'success',
      title: 'Cobranza Registrada',
      message: `Pago de $${form.amount} aplicado a ${target.name}. Nuevo saldo: $${res.newBalance}`,
    });

    closePaymentModal();

    if (accountDrawerOpenSignal.value && accountTargetCustomerSignal.value?.id === target.id) {
      loadCustomerMovements(target.id);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar cobranza';
    paymentErrorSignal.value = msg;
  } finally {
    isSubmittingPaymentSignal.value = false;
  }
}

// Ajuste Manual de Saldo
export function openBalanceAdjustModal(customer: CustomerItem): void {
  balanceAdjustTargetSignal.value = customer;
  balanceAdjustFormSignal.value = {
    type: 'credit',
    amount: 0,
    reason: 'Bonificación comercial',
  };
  balanceAdjustErrorSignal.value = null;
  balanceAdjustModalOpenSignal.value = true;
}

export function closeBalanceAdjustModal(): void {
  balanceAdjustModalOpenSignal.value = false;
  balanceAdjustTargetSignal.value = null;
  balanceAdjustErrorSignal.value = null;
}

export async function submitBalanceAdjustment(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  const target = balanceAdjustTargetSignal.value;
  if (!tenantId || !token || !target) return;

  const form = balanceAdjustFormSignal.value;
  if (form.amount < 0 || isNaN(form.amount)) {
    balanceAdjustErrorSignal.value = 'El importe del ajuste debe ser mayor o igual a 0';
    return;
  }
  if (!form.reason.trim()) {
    balanceAdjustErrorSignal.value = 'El motivo del ajuste es obligatorio para auditoría contable';
    return;
  }

  try {
    isSubmittingAdjustSignal.value = true;
    balanceAdjustErrorSignal.value = null;

    const res = await apiFetch<{
      customerId: string;
      previousBalance: number;
      delta: number;
      newBalance: number;
      movementId: string;
    }>(`tenants/${tenantId}/customers/${target.id}/adjustments`, {
      method: 'POST',
      body: {
        type: form.type,
        amount: form.amount,
        reason: form.reason.trim(),
      },
      token,
    });

    // Actualizar reactivamente el saldo en memoria
    customersSignal.value = customersSignal.value.map((c) => {
      if (c.id === target.id) {
        const isDebtor = res.newBalance > 0;
        const availableCredit = c.unrestricted ? null : Math.max(0, c.creditLimit + c.margin - res.newBalance);
        return {
          ...c,
          balance: res.newBalance,
          isDebtor,
          availableCredit,
        };
      }
      return c;
    });

    showToast({
      type: 'success',
      title: 'Ajuste de Saldo Aplicado',
      message: `Nuevo saldo de ${target.name}: $${res.newBalance} (variación: ${res.delta >= 0 ? '+' : ''}$${res.delta})`,
    });

    closeBalanceAdjustModal();

    if (accountDrawerOpenSignal.value && accountTargetCustomerSignal.value?.id === target.id) {
      loadCustomerMovements(target.id);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al ajustar saldo';
    balanceAdjustErrorSignal.value = msg;
  } finally {
    isSubmittingAdjustSignal.value = false;
  }
}

// Extracto de Cuenta Corriente (Drawer)
export async function openAccountStatement(customer: CustomerItem): Promise<void> {
  accountTargetCustomerSignal.value = customer;
  accountDrawerOpenSignal.value = true;
  await loadCustomerMovements(customer.id);
}

export function closeAccountStatement(): void {
  accountDrawerOpenSignal.value = false;
  accountTargetCustomerSignal.value = null;
  accountMovementsSignal.value = [];
}

export async function loadCustomerMovements(customerId: string): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    accountLoadingSignal.value = true;
    const movements = await apiFetch<AccountMovementItem[]>(`tenants/${tenantId}/customers/${customerId}/movements?limit=100`, {
      token,
    });
    accountMovementsSignal.value = movements;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cargar extracto';
    showToast({ type: 'error', title: 'Error de cuenta corriente', message: msg });
  } finally {
    accountLoadingSignal.value = false;
  }
}
