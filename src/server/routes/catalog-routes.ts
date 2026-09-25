import { Router, type Response } from 'express';
import { z } from 'zod';
import { CatalogService } from '../catalog/catalog-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

const createBranchSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'El nombre de la sucursal es requerido'),
  code: z.string().min(1, 'El código de la sucursal es requerido'),
});

const updateBranchSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
});

const createProductSchema = z.object({
  id: z.string().optional(),
  sku: z.string().min(1, 'El SKU es requerido'),
  barcodes: z.array(z.string()).default([]),
  name: z.string().min(1, 'El nombre del producto es requerido'),
  price: z.number().nonnegative('El precio no puede ser negativo'),
  taxRate: z.number().min(0).max(1).default(0.21),
  category: z.string().default('General'),
  tracksStock: z.boolean().default(true),
  blockedReason: z.string().nullable().optional(),
});

const updateProductSchema = z.object({
  sku: z.string().min(1).optional(),
  barcodes: z.array(z.string()).optional(),
  name: z.string().min(1).optional(),
  price: z.number().nonnegative('El precio no puede ser negativo').optional(),
  taxRate: z.number().min(0).max(1).optional(),
  category: z.string().optional(),
  tracksStock: z.boolean().optional(),
  blockedReason: z.string().nullable().optional(),
});

const deleteProductSchema = z.object({
  hard: z.boolean().optional(),
  reason: z.string().optional(),
});

function getCatalogService(req: AuthenticatedAdminRequest): CatalogService {
  if (req.activeTenantDb === undefined) {
    throw new Error('Tenant DB no inicializada en la petición');
  }
  return new CatalogService(req.activeTenantDb);
}

export function createCatalogRoutes(): Router {
  const router = Router({ mergeParams: true });

  // --- SUCURSALES ---

  router.get('/branches', (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const service = getCatalogService(req);
      const branches = service.listBranches();
      res.status(200).json(branches);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al listar sucursales';
      res.status(500).json({ error: msg });
    }
  });

  router.post('/branches', (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = createBranchSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos de sucursal inválidos' });
      return;
    }

    try {
      const service = getCatalogService(req);
      const created = service.createBranch(parseResult.data);
      res.status(201).json(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear sucursal';
      res.status(400).json({ error: msg });
    }
  });

  router.get('/branches/:branchId', (req: AuthenticatedAdminRequest, res: Response) => {
    const branchId = req.params['branchId'];
    if (branchId === undefined) {
      res.status(400).json({ error: 'ID de sucursal requerido' });
      return;
    }

    try {
      const service = getCatalogService(req);
      const branch = service.getBranch(branchId);
      if (!branch) {
        res.status(404).json({ error: 'Sucursal no encontrada' });
        return;
      }
      res.status(200).json(branch);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al obtener sucursal';
      res.status(500).json({ error: msg });
    }
  });

  router.put('/branches/:branchId', (req: AuthenticatedAdminRequest, res: Response) => {
    const branchId = req.params['branchId'];
    if (branchId === undefined) {
      res.status(400).json({ error: 'ID de sucursal requerido' });
      return;
    }

    const parseResult = updateBranchSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const service = getCatalogService(req);
      const updated = service.updateBranch(branchId, parseResult.data);
      if (!updated) {
        res.status(404).json({ error: 'Sucursal no encontrada' });
        return;
      }
      res.status(200).json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar sucursal';
      res.status(400).json({ error: msg });
    }
  });

  // --- PRODUCTOS ---

  router.get('/products', (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const service = getCatalogService(req);
      const search = typeof req.query['search'] === 'string' ? req.query['search'] : (typeof req.query['q'] === 'string' ? req.query['q'] : undefined);
      const category = typeof req.query['category'] === 'string' ? req.query['category'] : undefined;
      const blockedParam = typeof req.query['blocked'] === 'string' ? req.query['blocked'] : undefined;
      const blocked = blockedParam !== undefined ? blockedParam === 'true' : undefined;

      const limit = typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : undefined;
      const offset = typeof req.query['offset'] === 'string' ? parseInt(req.query['offset'], 10) : undefined;

      const products = service.listProducts({
        search,
        category,
        blocked,
        limit: Number.isNaN(limit) ? undefined : limit,
        offset: Number.isNaN(offset) ? undefined : offset,
      });

      res.status(200).json(products);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al listar productos';
      res.status(500).json({ error: msg });
    }
  });

  router.post('/products', (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = createProductSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos de producto inválidos' });
      return;
    }

    try {
      const service = getCatalogService(req);
      const product = service.createProduct(parseResult.data);
      res.status(201).json(product);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear producto';
      res.status(400).json({ error: msg });
    }
  });

  router.get('/products/:productId', (req: AuthenticatedAdminRequest, res: Response) => {
    const productId = req.params['productId'];
    if (productId === undefined) {
      res.status(400).json({ error: 'ID de producto requerido' });
      return;
    }

    try {
      const service = getCatalogService(req);
      const product = service.getProduct(productId);
      if (!product) {
        res.status(404).json({ error: 'Producto no encontrado' });
        return;
      }
      res.status(200).json(product);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al obtener producto';
      res.status(500).json({ error: msg });
    }
  });

  router.put('/products/:productId', (req: AuthenticatedAdminRequest, res: Response) => {
    const productId = req.params['productId'];
    if (productId === undefined) {
      res.status(400).json({ error: 'ID de producto requerido' });
      return;
    }

    const parseResult = updateProductSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const service = getCatalogService(req);
      const updated = service.updateProduct(productId, parseResult.data);
      if (!updated) {
        res.status(404).json({ error: 'Producto no encontrado' });
        return;
      }
      res.status(200).json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar producto';
      res.status(400).json({ error: msg });
    }
  });

  router.delete('/products/:productId', (req: AuthenticatedAdminRequest, res: Response) => {
    const productId = req.params['productId'];
    if (productId === undefined) {
      res.status(400).json({ error: 'ID de producto requerido' });
      return;
    }

    const parseResult = deleteProductSchema.safeParse(req.body ?? {});
    const hard = parseResult.success ? parseResult.data.hard : false;
    const reason = parseResult.success ? parseResult.data.reason : undefined;

    try {
      const service = getCatalogService(req);
      const result = service.deleteProduct(productId, { hard, blockedReason: reason });
      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al eliminar/bloquear producto';
      res.status(400).json({ error: msg });
    }
  });

  // --- CATEGORÍAS ---

  router.get('/categories', (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const service = getCatalogService(req);
      const categories = service.listCategories();
      res.status(200).json(categories);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al listar categorías';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
