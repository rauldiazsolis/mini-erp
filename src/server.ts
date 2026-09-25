import { createApp } from './app.js';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4100;

const app = createApp();

app.listen(PORT, () => {
  console.log(`[mini-erp] Servidor iniciado en http://localhost:${PORT}`);
});
