import type { SeedCustomer } from './types.ts';

export const DEMO_CUSTOMERS: SeedCustomer[] = [
  {
    id: 'cust-cf',
    name: 'Consumidor Final',
    document: null,
    phone: null,
    creditLimit: 0,
    margin: 0,
    balance: 0,
    unrestricted: false,
  },
  {
    id: 'cust-juan',
    name: 'Juan Pérez',
    document: '20-12345678-9',
    phone: '11-4567-8901',
    creditLimit: 50000,
    margin: 10000,
    balance: 12500,
    unrestricted: false,
  },
  {
    id: 'cust-maria',
    name: 'María Gómez',
    document: '27-98765432-1',
    phone: '11-9876-5432',
    creditLimit: 30000,
    margin: 5000,
    balance: 0,
    unrestricted: false,
  },
  {
    id: 'cust-carlos',
    name: 'Carlos Vecino (Fiado sin tope)',
    document: '20-44556677-8',
    phone: '11-3322-1100',
    creditLimit: 0,
    margin: 0,
    balance: 3800,
    unrestricted: true, // Fiado sin límite
  },
];
