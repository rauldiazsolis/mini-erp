/** Logo de mini contax (#18): un ticket de caja con la "c" de Contax. El favicon es otra variante. */
export function Logo(props: { class?: string | undefined }) {
  return (
    <svg class={props.class ?? 'w-10 h-10'} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <path d="M9.5 6.5h13v19l-2.17-1.5-2.16 1.5-2.17-1.5-2.17 1.5-2.16-1.5-2.17 1.5z" fill="#fff" />
      <path d="M18.3 11.7A3.3 3.3 0 1 0 18.3 16.3" fill="none" stroke="#4f46e5" stroke-width="2.2" stroke-linecap="round" />
      <path d="M12.5 20.5h7" stroke="#4f46e5" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}
