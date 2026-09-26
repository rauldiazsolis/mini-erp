import type { Request, Response, NextFunction } from 'express';

// Formato de colores ANSI para consola
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function formatStatus(status: number): string {
  if (status >= 500) return `${c.red}${c.bold}${String(status)}${c.reset}`;
  if (status >= 400) return `${c.yellow}${c.bold}${String(status)}${c.reset}`;
  if (status >= 300) return `${c.cyan}${String(status)}${c.reset}`;
  return `${c.green}${String(status)}${c.reset}`;
}

function timeStamp(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${c.gray}${h}:${m}:${s}${c.reset}`;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();

  res.on('finish', () => {
    const elapsed = Math.round(performance.now() - start);
    const statusFormatted = formatStatus(res.statusCode);
    const method = `${c.bold}${req.method}${c.reset}`;
    const url = req.originalUrl || req.url;

    // Diferenciar entre tráfico POS vs Admin
    if (url.startsWith('/connector')) {
      const tag = `${c.cyan}[POS]${c.reset}`;
      console.log(`${timeStamp()} ${tag} ${method} ${url} ${statusFormatted} ${c.dim}(${String(elapsed)}ms)${c.reset}`);
    } else if (url.startsWith('/api')) {
      const tag = `${c.magenta}[ADMIN]${c.reset}`;
      console.log(`${timeStamp()} ${tag} ${method} ${url} ${statusFormatted} ${c.dim}(${String(elapsed)}ms)${c.reset}`);
    } else {
      console.log(`${timeStamp()} ${method} ${url} ${statusFormatted} ${c.dim}(${String(elapsed)}ms)${c.reset}`);
    }
  });

  next();
}

export const posLog = {
  push: (info: {
    lotId: string;
    deviceId: string;
    branch: string;
    pos: string;
    events: { type: string; id: string; detail?: string }[];
    status: 'ok' | 'issues';
  }) => {
    const eventsSummary = info.events
      .map((e) => `${c.bold}${e.type}${c.reset}${e.detail ? ` (${e.detail})` : ''}`)
      .join(', ');

    const statusBadge =
      info.status === 'ok'
        ? `${c.green}✔ OK${c.reset}`
        : `${c.yellow}⚠ ISSUES${c.reset}`;

    console.log(
      `   ${c.cyan}└─📦 Lote Push:${c.reset} ${c.dim}id=${c.reset}${info.lotId} ${c.dim}[${info.branch}/${info.pos}]${c.reset}\n` +
      `      ${c.dim}Eventos (${String(info.events.length)}):${c.reset} ${eventsSummary}\n` +
      `      ${c.dim}Resultado:${c.reset} ${statusBadge}`,
    );
  },

  pull: (info: {
    branch?: string;
    pos?: string;
    cursors: { products?: string; customers?: string };
    productsCount: number;
    customersCount: number;
    stockCount: number;
    pendingLotsQueried: number;
  }) => {
    const mode = info.cursors.products || info.cursors.customers ? 'Delta' : 'Foto Completa';
    console.log(
      `   ${c.cyan}└─📥 Pull (${mode}):${c.reset} ` +
      `${c.bold}${String(info.productsCount)}${c.reset} prod, ` +
      `${c.bold}${String(info.customersCount)}${c.reset} cust, ` +
      `${c.bold}${String(info.stockCount)}${c.reset} stock` +
      (info.pendingLotsQueried > 0 ? ` ${c.dim}(${String(info.pendingLotsQueried)} lotes consultados)${c.reset}` : ''),
    );
  },

  hold: (info: {
    customerId: string;
    amount: number;
    approved: boolean;
    reasonCode?: string;
    holdId?: string;
  }) => {
    const outcome = info.approved
      ? `${c.green}✔ APROBADO${c.reset} ${c.dim}(hold=${info.holdId ?? ''})${c.reset}`
      : `${c.red}✖ RECHAZADO${c.reset} ${c.dim}(motivo=${info.reasonCode ?? ''})${c.reset}`;

    console.log(
      `   ${c.cyan}└─💳 Hold Crédito:${c.reset} Cliente=${c.bold}${info.customerId}${c.reset} Monto=${c.bold}$${String(info.amount)}${c.reset} -> ${outcome}`,
    );
  },
};
