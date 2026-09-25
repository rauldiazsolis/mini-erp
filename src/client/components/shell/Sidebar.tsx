import type { ComponentChildren } from 'preact';
import {
  activeViewSignal,
  navigateTo,
  mobileMenuOpenSignal,
  toggleMobileMenu,
  type ActiveNavView,
} from '../../state/navigation-state.ts';

type NavItem = {
  id: ActiveNavView;
  label: string;
  badge?: string;
  icon: (active: boolean) => ComponentChildren;
};

const navItems: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (active) => (
      <svg class={`w-5 h-5 ${active ? 'text-indigo-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    id: 'catalog',
    label: 'Catálogo & Precios',
    icon: (active) => (
      <svg class={`w-5 h-5 ${active ? 'text-indigo-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
        />
      </svg>
    ),
  },
  {
    id: 'stock',
    label: 'Stock & Kardex',
    icon: (active) => (
      <svg class={`w-5 h-5 ${active ? 'text-indigo-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
        />
      </svg>
    ),
  },
  {
    id: 'customers',
    label: 'Clientes & CC',
    icon: (active) => (
      <svg class={`w-5 h-5 ${active ? 'text-indigo-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
  },
  {
    id: 'bulk',
    label: 'Operaciones Masivas',
    icon: (active) => (
      <svg class={`w-5 h-5 ${active ? 'text-indigo-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Configuración & POS',
    icon: (active) => (
      <svg class={`w-5 h-5 ${active ? 'text-indigo-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const currentView = activeViewSignal.value;
  const isMobileOpen = mobileMenuOpenSignal.value;

  const content = (
    <div class="h-full flex flex-col justify-between p-4 bg-slate-900 border-r border-slate-800">
      <div class="space-y-6">
        {/* App Logo */}
        <div class="flex items-center gap-3 px-2 py-1">
          <div class="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <span class="text-sm font-black tracking-tight text-white block">mini-erp</span>
            <span class="text-[10px] text-slate-400 font-medium">Connector v4.0.0</span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav class="space-y-1">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                class={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/20 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <div class="flex items-center gap-3">
                  {item.icon(isActive)}
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span class="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-bold">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div class="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-slate-500">Offline-POS</span>
          <span class="text-emerald-400 font-semibold flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Online
          </span>
        </div>
        <div class="text-[10px] text-slate-500 font-mono">Puerto: 4100 • Express</div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside class="hidden lg:block w-64 shrink-0 h-screen sticky top-0">{content}</aside>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div class="lg:hidden fixed inset-0 z-50 flex">
          <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={toggleMobileMenu}></div>
          <div class="relative w-72 max-w-[80vw] h-full shadow-2xl animate-in slide-in-from-left duration-200">
            {content}
          </div>
        </div>
      )}
    </>
  );
}
