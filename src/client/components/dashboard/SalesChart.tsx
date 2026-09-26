import { signal } from '@preact/signals';
import {
  dashboardDataSignal,
  formatCurrency,
  formatNumber,
} from '../../state/dashboard-state.ts';
import { Card, CardHeader } from '../ui/Card.tsx';

export const hoveredIndexSignal = signal<number | null>(null);

export function SalesChart() {
  const data = dashboardDataSignal.value;
  const timeline = data?.timeline ?? [];

  if (timeline.length === 0) {
    return (
      <Card>
        <CardHeader title="Evolución de Ventas" description="Facturación diaria y volumen de operaciones" />
        <div class="h-64 flex items-center justify-center text-xs text-slate-500">
          No hay actividad registrada en el período seleccionado
        </div>
      </Card>
    );
  }

  // Dimensiones del canvas SVG
  const width = 800;
  const height = 260;
  const paddingLeft = 60;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(...timeline.map((p) => p.total), 1000);
  const roundedMax = Math.ceil(maxVal / 1000) * 1000;

  // Calcular coordenadas
  const points = timeline.map((item, idx) => {
    const x = paddingLeft + (idx / Math.max(timeline.length - 1, 1)) * chartWidth;
    const y = paddingTop + chartHeight - (item.total / roundedMax) * chartHeight;
    return { x, y, item };
  });

  // Generar path SVG para la línea y el área con gradiente
  const linePath = points.reduce((acc, curr, idx) => {
    return idx === 0 ? `M ${String(curr.x)} ${String(curr.y)}` : `${acc} L ${String(curr.x)} ${String(curr.y)}`;
  }, '');

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const bottomY = String(paddingTop + chartHeight);
  const areaPath = `${linePath} L ${String(lastPoint?.x ?? 0)} ${bottomY} L ${String(firstPoint?.x ?? 0)} ${bottomY} Z`;

  // Marcas en eje Y (4 niveles)
  const yTicks = [0, 0.33, 0.66, 1].map((ratio) => {
    const val = Math.round(roundedMax * ratio);
    const y = paddingTop + chartHeight - ratio * chartHeight;
    return { val, y };
  });

  const hoveredIdx = hoveredIndexSignal.value;
  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <Card class="relative">
      <CardHeader
        title="Evolución de Ventas"
        description="Facturación y volumen de operaciones a lo largo del tiempo"
      >
        {activePoint && (
          <div class="text-xs bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 px-3 py-1 rounded-xl text-indigo-700 dark:text-indigo-300 font-medium">
            <strong>{activePoint.item.label}:</strong> {formatCurrency(activePoint.item.total)} (
            {formatNumber(activePoint.item.count)} tickets)
          </div>
        )}
      </CardHeader>

      <div class="w-full overflow-x-auto">
        <svg
          viewBox="0 0 800 260"
          class="w-full h-auto min-w-[500px] select-none"
          onMouseLeave={() => { hoveredIndexSignal.value = null; }}
        >
          <defs>
            {/* Gradiente vertical para el área de ventas */}
            <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgb(99 102 241)" stop-opacity="0.35" />
              <stop offset="100%" stop-color="rgb(99 102 241)" stop-opacity="0.0" />
            </linearGradient>
          </defs>

          {/* Líneas horizontales de guía (Grid) */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={tick.y}
                x2={width - paddingRight}
                y2={tick.y}
                stroke="currentColor"
                class="text-slate-200 dark:text-slate-800"
                stroke-dasharray={i === 0 ? 'none' : '4 4'}
              />
              <text
                x={paddingLeft - 10}
                y={tick.y + 4}
                class="fill-slate-400 dark:fill-slate-500 text-[10px]"
                text-anchor="end"
                font-family="monospace"
              >
                ${(tick.val / 1000).toFixed(0)}k
              </text>
            </g>
          ))}

          {/* Área con gradiente */}
          <path d={areaPath} fill="url(#salesGradient)" />

          {/* Línea principal */}
          <path
            d={linePath}
            fill="none"
            stroke="rgb(99 102 241)"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />

          {/* Puntos interactivos y etiquetas en eje X */}
          {points.map((p, idx) => {
            const isHovered = hoveredIdx === idx;
            return (
              <g key={idx} class="cursor-pointer">
                {/* Zona transparente grande para capturar hover fácilmente */}
                <rect
                  x={p.x - 20}
                  y={paddingTop}
                  width="40"
                  height={chartHeight}
                  fill="transparent"
                  onMouseEnter={() => (hoveredIndexSignal.value = idx)}
                />

                {/* Línea vertical indicadora en hover */}
                {isHovered && (
                  <line
                    x1={p.x}
                    y1={paddingTop}
                    x2={p.x}
                    y2={paddingTop + chartHeight}
                    stroke="rgb(129 140 248 / 0.6)"
                    stroke-width="1.5"
                    stroke-dasharray="2 2"
                  />
                )}

                {/* Punto en la línea */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? 6 : 4}
                  fill={isHovered ? '#6366f1' : '#ffffff'}
                  stroke="#6366f1"
                  stroke-width="2"
                  class="transition-all duration-150"
                />

                {/* Etiqueta X */}
                <text
                  x={p.x}
                  y={height - 12}
                  class={`text-[10px] transition-colors ${
                    isHovered
                      ? 'fill-slate-900 dark:fill-slate-100 font-bold'
                      : 'fill-slate-500 dark:fill-slate-400 font-medium'
                  }`}
                  text-anchor="middle"
                >
                  {p.item.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </Card>
  );
}
