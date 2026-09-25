import type { ComponentChildren, JSX } from 'preact';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = JSX.IntrinsicElements['button'] & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ComponentChildren;
};

export function Button(props: ButtonProps) {
  const { variant = 'primary', size = 'md', loading = false, children, class: className = '', disabled, ...rest } = props;

  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed select-none';

  const sizeStyles: Record<ButtonSize, string> = {
    sm: 'text-xs px-3 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  };

  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30 focus:ring-indigo-500',
    secondary:
      'bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-100 border border-slate-700/80 focus:ring-slate-500',
    outline:
      'bg-transparent hover:bg-slate-800/60 active:bg-slate-800 text-slate-300 border border-slate-700 focus:ring-slate-500',
    ghost:
      'bg-transparent hover:bg-slate-800/50 active:bg-slate-800 text-slate-400 hover:text-slate-200 focus:ring-slate-500',
    danger:
      'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-lg shadow-rose-600/20 focus:ring-rose-500',
  };

  return (
    <button
      class={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      )}
      {children}
    </button>
  );
}
