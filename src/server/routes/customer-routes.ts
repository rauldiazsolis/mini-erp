import { Router, type Response } from 'express';
import { z } from 'zod';
import { CustomerService } from '../customer/customer-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { customerServiceDef } from '../di/container.ts';

const createCustomerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'El nombre del cliente es requerido'),
  document: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  creditLimit: z.number().nonnegative('El límite de crédito no puede ser negativo').optional(),
  margin: z.number().nonnegative('El margen de crédito no puede ser negativo').optional(),
  unrestricted: z.boolean().optional(),
  initialBalance: z.number().optional(),
  blockedReason: z.string().nullable().optional(),
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  document: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  creditLimit: z.number().nonnegative('El límite de crédito no puede ser negativo').optional(),
  margin: z.number().nonnegative('El margen de crédito no puede ser negativo').optional(),
  unrestricted: z.boolean().optional(),
  blockedReason: z.string().nullable().optional(),
});

const registerPaymentSchema = z.object({
  amount: z.number().positive('El monto del pago debe ser mayor a 0'),
  method: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
});

const adjustBalanceSchema = z.object({
  type: z.enum(['credit', 'debit', 'set'], {
    errorMap: () => ({ message: "El tipo de ajuste debe ser 'credit', 'debit' o 'set'" }),
  }),
  amount: z.number().nonnegative('El monto debe ser mayor o igual a 0'),
  reason: z.string().min(1, 'El motivo del ajuste es obligatorio para auditoría contable'),
});

const deleteCustomerSchema = z.object({
  hard: z.boolean().optional(),
  reason: z.string().optional(),
});

function getCustomerService(req: AuthenticatedAdminRequest): CustomerService {
  if (req.tenantScope !== undefined) {
    return req.tenantScope.use(customerServiceDef);
  }
  if (req.activeTenantDb !== undefined) {
    return new CustomerService(req.activeTenantDb);
  }
  throw new Error('Tenant DB o Scope no inicializado en la petición');
}

export function createCustomerRoutes(): Router {
  const router = Router({ mergeParams: true });

  // GET /customers - Listar clientes con filtros
  router.get('/customers', (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const service = getCustomerService(req);
      const search =
        typeof req.query['search'] === 'string'
          ? req.query['search']
          : typeof req.query['q'] === 'string'
            ? req.query['q']
            : undefined;
      const debtorsOnly = req.query['debtorsOnly'] === 'true';
      const blockedParam = typeof req.query['blocked'] === 'string' ? req.query['blocked'] : undefined;
      const blocked = blockedParam !== undefined ? blockedParam === 'true' : undefined;

      const limit = typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : undefined;
      const offset = typeof req.query['offset'] === 'string' ? parseInt(req.query['offset'], 10) : undefined;

      const customers = service.listCustomers({
        search,
        debtorsOnly,
        blocked,
        limit: Number.isNaN(limit) ? undefined : limit,
        offset: Number.isNaN(offset) ? undefined : offset,
      });

      res.status(200).json(customers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al listar clientes';
      res.status(500).json({ error: msg });
    }
  });

  // POST /customers - Crear nuevo cliente
  router.post('/customers', (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = createCustomerSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos de cliente inválidos' });
      return;
    }

    try {
      const service = getCustomerService(req);
      const customer = service.createCustomer(parseResult.data);
      res.status(201).json(customer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear cliente';
      res.status(400).json({ error: msg });
    }
  });

  // GET /customers/:customerId - Detalle de cliente
  router.get('/customers/:customerId', (req: AuthenticatedAdminRequest, res: Response) => {
    const customerId = req.params['customerId'];
    if (customerId === undefined) {
      res.status(400).json({ error: 'ID de cliente requerido' });
      return;
    }

    try {
      const service = getCustomerService(req);
      const customer = service.getCustomer(customerId);
      if (!customer) {
        res.status(404).json({ error: 'Cliente no encontrado' });
        return;
      }
      res.status(200).json(customer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al obtener cliente';
      res.status(500).json({ error: msg });
    }
  });

  // PUT /customers/:customerId - Actualizar cliente
  router.put('/customers/:customerId', (req: AuthenticatedAdminRequest, res: Response) => {
    const customerId = req.params['customerId'];
    if (customerId === undefined) {
      res.status(400).json({ error: 'ID de cliente requerido' });
      return;
    }

    const parseResult = updateCustomerSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const service = getCustomerService(req);
      const updated = service.updateCustomer(customerId, parseResult.data);
      if (!updated) {
        res.status(404).json({ error: 'Cliente no encontrado' });
        return;
      }
      res.status(200).json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar cliente';
      res.status(400).json({ error: msg });
    }
  });

  // DELETE /customers/:customerId - Bloquear o eliminar cliente
  router.delete('/customers/:customerId', (req: AuthenticatedAdminRequest, res: Response) => {
    const customerId = req.params['customerId'];
    if (customerId === undefined) {
      res.status(400).json({ error: 'ID de cliente requerido' });
      return;
    }

    const parseResult = deleteCustomerSchema.safeParse(req.body ?? {});
    const hard = parseResult.success ? parseResult.data.hard : false;
    const reason = parseResult.success ? parseResult.data.reason : undefined;

    try {
      const service = getCustomerService(req);
      const result = service.deleteCustomer(customerId, { hard, blockedReason: reason });
      res.status(200).json(result);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode ?? 400;
      const msg = err instanceof Error ? err.message : 'Error al eliminar/bloquear cliente';
      res.status(statusCode).json({ error: msg });
    }
  });

  // POST /customers/:customerId/payments - Cobranza manual de cuenta corriente
  router.post('/customers/:customerId/payments', (req: AuthenticatedAdminRequest, res: Response) => {
    const customerId = req.params['customerId'];
    if (customerId === undefined) {
      res.status(400).json({ error: 'ID de cliente requerido' });
      return;
    }

    const parseResult = registerPaymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos de pago inválidos' });
      return;
    }

    try {
      const service = getCustomerService(req);
      const result = service.registerPayment(customerId, parseResult.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode ?? 400;
      const msg = err instanceof Error ? err.message : 'Error al registrar cobranza';
      res.status(statusCode).json({ error: msg });
    }
  });

  // POST /customers/:customerId/adjustments - Ajuste manual transparente de saldo
  router.post('/customers/:customerId/adjustments', (req: AuthenticatedAdminRequest, res: Response) => {
    const customerId = req.params['customerId'];
    if (customerId === undefined) {
      res.status(400).json({ error: 'ID de cliente requerido' });
      return;
    }

    const parseResult = adjustBalanceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos de ajuste inválidos' });
      return;
    }

    try {
      const service = getCustomerService(req);
      const result = service.adjustBalance(customerId, parseResult.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode ?? 400;
      const msg = err instanceof Error ? err.message : 'Error al ajustar saldo';
      res.status(statusCode).json({ error: msg });
    }
  });

  // GET /customers/:customerId/movements - Extracto de cuenta corriente
  router.get('/customers/:customerId/movements', (req: AuthenticatedAdminRequest, res: Response) => {
    const customerId = req.params['customerId'];
    if (customerId === undefined) {
      res.status(400).json({ error: 'ID de cliente requerido' });
      return;
    }

    try {
      const service = getCustomerService(req);
      const type = typeof req.query['type'] === 'string' ? req.query['type'] : undefined;
      const from = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
      const to = typeof req.query['to'] === 'string' ? req.query['to'] : undefined;
      const limit = typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : undefined;
      const offset = typeof req.query['offset'] === 'string' ? parseInt(req.query['offset'], 10) : undefined;

      const movements = service.listMovements(customerId, {
        type,
        from,
        to,
        limit: Number.isNaN(limit) ? undefined : limit,
        offset: Number.isNaN(offset) ? undefined : offset,
      });

      res.status(200).json(movements);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al obtener extracto de cuenta corriente';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
