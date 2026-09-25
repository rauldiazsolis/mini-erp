export type SeedProduct = {
  sku: string;
  name: string;
  price: number;
  taxRate?: number;
  category: string;
  barcodes: string[];
  stock: number;
};

export type SeedCustomer = {
  id?: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  creditLimit: number;
  margin: number;
  balance: number;
  unrestricted?: boolean;
};

export type BusinessPreset = 'kiosco' | 'ferreteria' | 'almacen';
