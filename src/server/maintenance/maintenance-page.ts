/**
 * Página de mantenimiento (#47): autocontenida, sin el SPA (que todavía no está montado). Consulta
 * `/health` cada 5 s y recarga cuando el servidor vuelve.
 */
export const MAINTENANCE_PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>mini contax</title>
<noscript><meta http-equiv="refresh" content="15" /></noscript>
<style>
  :root { --bg: #f8fafc; --fg: #0f172a; --muted: #475569; }
  @media (prefers-color-scheme: dark) { :root { --bg: #020617; --fg: #f1f5f9; --muted: #94a3b8; } }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 0 16px; }
  main { max-width: 28rem; text-align: center; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  p { color: var(--muted); margin: 0; line-height: 1.5; }
</style>
</head>
<body>
<main>
  <svg width="56" height="56" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#4f46e5" />
    <path d="M9.5 6.5h13v19l-2.17-1.5-2.16 1.5-2.17-1.5-2.17 1.5-2.16-1.5-2.17 1.5z" fill="#fff" />
    <path d="M18.3 11.7A3.3 3.3 0 1 0 18.3 16.3" fill="none" stroke="#4f46e5" stroke-width="2.2" stroke-linecap="round" />
    <path d="M12.5 20.5h7" stroke="#4f46e5" stroke-width="1.6" stroke-linecap="round" />
  </svg>
  <h1>Estamos actualizando mini contax</h1>
  <p>Vuelve sola en cuanto termine; no hace falta recargar.</p>
</main>
<script>
  setInterval(function () {
    fetch('/health', { cache: 'no-store' }).then(function (res) {
      if (res.status === 200) location.reload();
    }).catch(function () {});
  }, 5000);
</script>
</body>
</html>
`;
