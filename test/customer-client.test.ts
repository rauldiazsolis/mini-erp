import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  customersSignal,
  customerSearchSignal,
  customerDebtorsOnlySignal,
  customerBlockedFilterSignal,
  filteredCustomersSignal,
  customerStatsSignal,
  customerModalOpenSignal,
  customerFormDataSignal,
  openNewCustomerModal,
  openEditCustomerModal,
  closeCustomerModal,
  submitCustomerForm,
  paymentModalOpenSignal,
  paymentTargetCustomerSignal,
  paymentFormDataSignal,
  openPaymentModal,
  closePaymentModal,
  submitPayment,
  balanceAdjustModalOpenSignal,
  balanceAdjustTargetSignal,
  balanceAdjustFormSignal,
  openBalanceAdjustModal,
  submitBalanceAdjustment,
  accountDrawerOpenSignal,
  accountTargetCustomerSignal,
  accountMovementsSignal,
  openAccountStatement,
  closeAccountStatement,
  type CustomerItem,
} from '../src/client/state/customer-state.ts';
import {
  tokenSignal,
  activeTenantIdSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';

const mockCustomerA: CustomerItem = {
  id: 'cust-1',
  name: 'Juan Pérez',
  document: '20-30111222-7',
  phone: '11-4455-6677',
  creditLimit: 50000,
  margin: 10000,
  balance: 15000,
  availableCredit: 45000,
  unrestricted: false,
  isDebtor: true,
  blockedReason: null,
  createdAt: '2026-09-25T10:00:00Z',
  updatedAt: '2026-09-25T10:00:00Z',
};

const mockCustomerB: CustomerItem = {
  id: 'cust-2',
  name: 'María Gómez',
  document: '27-40999888-4',
  phone: '11-8899-0011',
  creditLimit: 30000,
  margin: 5000,
  balance: 0,
  availableCredit: 35000,
  unrestricted: false,
  isDebtor: false,
  blockedReason: null,
  createdAt: '2026-09-25T10:00:00Z',
  updatedAt: '2026-09-25T10:00:00Z',
};

const mockCustomerC: CustomerItem = {
  id: 'cust-3',
  name: 'Comercial del Centro S.A.',
  document: '30-71000222-9',
  phone: '11-5566-7788',
  creditLimit: 200000,
  margin: 50000,
  balance: 75000,
  availableCredit: 175000,
  unrestricted: true,
  isDebtor: true,
  blockedReason: 'Falta de pago reiterada',
  createdAt: '2026-09-25T10:00:00Z',
  updatedAt: '2026-09-25T10:00:00Z',
};

describe('Módulo de Clientes y Cuentas Corrientes (Etapa 4.3)', () => {
  beforeEach(() => {
    customersSignal.value = [mockCustomerA, mockCustomerB, mockCustomerC];
    customerSearchSignal.value = '';
    customerDebtorsOnlySignal.value = false;
    customerBlockedFilterSignal.value = 'all';

    customerModalOpenSignal.value = false;
    paymentModalOpenSignal.value = false;
    paymentTargetCustomerSignal.value = null;
    balanceAdjustModalOpenSignal.value = false;
    balanceAdjustTargetSignal.value = null;
    accountDrawerOpenSignal.value = false;
    accountTargetCustomerSignal.value = null;
    accountMovementsSignal.value = [];

    tokenSignal.value = 'mock-token';
    activeTenantIdSignal.value = 'tienda-test';
    userTenantsSignal.value = [
      { tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' },
    ];
    vi.restoreAllMocks();
  });

  describe('Filtros y Métricas de Cartera', () => {
    it('calcula las estadísticas consolidadas de clientes y deuda total', () => {
      const stats = customerStatsSignal.value;
      expect(stats.totalCustomers).toBe(3);
      expect(stats.totalDebtors).toBe(2);
      expect(stats.totalDebtAmount).toBe(90000); // 15000 + 75000
    });

    it('filtra clientes por búsqueda en nombre, documento o teléfono', () => {
      customerSearchSignal.value = 'juan';
      expect(filteredCustomersSignal.value.map((c) => c.id)).toEqual(['cust-1']);

      customerSearchSignal.value = '40999888';
      expect(filteredCustomersSignal.value.map((c) => c.id)).toEqual(['cust-2']);

      customerSearchSignal.value = '5566-7788';
      expect(filteredCustomersSignal.value.map((c) => c.id)).toEqual(['cust-3']);
    });

    it('filtra solo clientes deudores', () => {
      customerDebtorsOnlySignal.value = true;
      expect(filteredCustomersSignal.value.length).toBe(2);
      expect(filteredCustomersSignal.value.every((c) => c.balance > 0)).toBe(true);
    });

    it('filtra por estado habilitado vs bloqueado', () => {
      customerBlockedFilterSignal.value = 'active';
      expect(filteredCustomersSignal.value.length).toBe(2);
      expect(filteredCustomersSignal.value.every((c) => c.blockedReason === null)).toBe(true);

      customerBlockedFilterSignal.value = 'blocked';
      expect(filteredCustomersSignal.value.length).toBe(1);
      expect(filteredCustomersSignal.value[0]?.id).toBe('cust-3');
    });
  });

  describe('Alta y Edición de Cliente', () => {
    it('openNewCustomerModal inicializa campos limpios', () => {
      openNewCustomerModal();
      expect(customerModalOpenSignal.value).toBe(true);
      expect(customerFormDataSignal.value.creditLimit).toBe(50000);
      expect(customerFormDataSignal.value.unrestricted).toBe(false);

      closeCustomerModal();
      expect(customerModalOpenSignal.value).toBe(false);
    });

    it('openEditCustomerModal precarga datos existentes', () => {
      openEditCustomerModal(mockCustomerA);
      expect(customerModalOpenSignal.value).toBe(true);
      expect(customerFormDataSignal.value.name).toBe('Juan Pérez');
      expect(customerFormDataSignal.value.creditLimit).toBe(50000);
    });

    it('crea un nuevo cliente vía POST y lo agrega a la lista reactiva', async () => {
      openNewCustomerModal();
      customerFormDataSignal.value = {
        name: 'Roberto Carlos',
        document: '20-12345678-9',
        phone: '11-2233-4455',
        creditLimit: 80000,
        margin: 15000,
        unrestricted: false,
        initialBalance: 0,
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response(
          JSON.stringify({
            id: 'cust-4',
            name: 'Roberto Carlos',
            document: '20-12345678-9',
            phone: '11-2233-4455',
            creditLimit: 80000,
            margin: 15000,
            balance: 0,
            availableCredit: 95000,
            unrestricted: false,
            isDebtor: false,
            blockedReason: null,
            createdAt: '2026-09-25T11:00:00Z',
            updatedAt: '2026-09-25T11:00:00Z',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await submitCustomerForm();

        expect(customerModalOpenSignal.value).toBe(false);
        expect(customersSignal.value.length).toBe(4);
        expect(customersSignal.value[0]?.name).toBe('Roberto Carlos');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Cobranza Manual de Cuenta Corriente', () => {
    it('openPaymentModal prellena el monto de la deuda actual', () => {
      openPaymentModal(mockCustomerA);
      expect(paymentModalOpenSignal.value).toBe(true);
      expect(paymentTargetCustomerSignal.value?.id).toBe('cust-1');
      expect(paymentFormDataSignal.value.amount).toBe(15000);

      closePaymentModal();
      expect(paymentModalOpenSignal.value).toBe(false);
    });

    it('registra cobranza vía POST y actualiza el saldo del cliente en memoria', async () => {
      openPaymentModal(mockCustomerA);
      paymentFormDataSignal.value = {
        amount: 5000,
        method: 'transferencia',
        reference: 'TRF-99238',
        description: 'Pago a cuenta',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response(
          JSON.stringify({
            customerId: 'cust-1',
            previousBalance: 15000,
            amount: 5000,
            newBalance: 10000,
            movementId: 'mov-pay-1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await submitPayment();

        expect(paymentModalOpenSignal.value).toBe(false);
        const updated = customersSignal.value.find((c) => c.id === 'cust-1');
        expect(updated?.balance).toBe(10000);
        expect(updated?.availableCredit).toBe(50000); // 50000 + 10000 - 10000 = 50000
        expect(updated?.isDebtor).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Ajuste Manual de Saldo y Extracto', () => {
    it('openBalanceAdjustModal y submitBalanceAdjustment actualizan el saldo con auditoría', async () => {
      openBalanceAdjustModal(mockCustomerA);
      expect(balanceAdjustModalOpenSignal.value).toBe(true);

      balanceAdjustFormSignal.value = {
        type: 'credit',
        amount: 2000,
        reason: 'Bonificación por reclamo de mercadería',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response(
          JSON.stringify({
            customerId: 'cust-1',
            previousBalance: 15000,
            delta: -2000,
            newBalance: 13000,
            movementId: 'adj-1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await submitBalanceAdjustment();

        expect(balanceAdjustModalOpenSignal.value).toBe(false);
        const updated = customersSignal.value.find((c) => c.id === 'cust-1');
        expect(updated?.balance).toBe(13000);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('openAccountStatement consulta y almacena los movimientos cronológicos', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/movements')) {
          return Promise.resolve(new Response(
            JSON.stringify([
              {
                id: 'mov-1',
                customerId: 'cust-1',
                type: 'sale',
                amount: 15000,
                balanceAfter: 15000,
                description: 'Venta fiada en caja',
                saleId: 'sale-123',
                createdAt: '2026-09-25T11:00:00Z',
              },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        await openAccountStatement(mockCustomerA);

        expect(accountDrawerOpenSignal.value).toBe(true);
        expect(accountTargetCustomerSignal.value?.id).toBe('cust-1');
        expect(accountMovementsSignal.value.length).toBe(1);
        expect(accountMovementsSignal.value[0]?.amount).toBe(15000);

        closeAccountStatement();
        expect(accountDrawerOpenSignal.value).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
