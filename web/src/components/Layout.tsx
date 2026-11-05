import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Search, Download, Package, FolderTree, Calculator, RefreshCw, ShoppingCart, Truck, PackageCheck,
  Users, CreditCard, Bot, Store, BarChart3, Plug, Settings, Menu, ChevronsLeft, ChevronsRight, Moon, Sun, LogOut, Bell,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { api } from '../lib/api';
import { cx } from './ui';
import { ago } from '../lib/format';

export const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/find', label: 'Find Products', icon: Search },
  { to: '/import', label: 'Product Importer', icon: Download },
  { to: '/products', label: 'My Products', icon: Package },
  { to: '/categories', label: 'Categories', icon: FolderTree },
  { to: '/pricing', label: 'Pricing Rules', icon: Calculator },
  { to: '/sync', label: 'Inventory Synchronization', icon: RefreshCw },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/supplier-orders', label: 'Supplier Orders', icon: PackageCheck },
  { to: '/suppliers', label: 'Local Suppliers', icon: Store },
  { to: '/shipping', label: 'Shipping & Tracking', icon: Truck },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/automation', label: 'Automation Center', icon: Bot },
  { to: '/analytics', label: 'Analytics & Reports', icon: BarChart3 },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('theme', dark ? 'dark' : 'light'); }, [dark]);
  return [dark, setDark] as const;
}

export default function Layout() {
  const { user, stores, store, selectStore, logout } = useSession();
  const [collapsed, setCollapsed] = useState(localStorage.getItem('nav') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useTheme();
  const [notes, setNotes] = useState<any[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const loc = useLocation();

  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => { localStorage.setItem('nav', collapsed ? 'collapsed' : 'open'); }, [collapsed]);
  useEffect(() => {
    if (!store) return;
    api<{ notifications: any[] }>('/notifications').then((r) => setNotes(r.notifications)).catch(() => setNotes([]));
  }, [store, loc.pathname]);
  const unread = notes.filter((n) => !n.read).length;

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <img src="/favicon.svg" className="h-7 w-7" alt="" />
        {!collapsed && <div className="leading-tight"><div className="text-sm font-semibold">Davetech Importer</div><div className="text-[10px] text-slate-500">Import. Automate. Grow.</div></div>}
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} title={collapsed ? label : undefined}
            className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
              isActive ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-100' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800')}>
            <Icon className="h-4 w-4 shrink-0" />{!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </div>
      <button onClick={() => setCollapsed(!collapsed)} className="hidden items-center gap-2 border-t border-slate-200 px-5 py-3 text-xs text-slate-500 hover:text-slate-800 dark:border-slate-800 lg:flex">
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={cx('sticky top-0 hidden h-screen shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block', collapsed ? 'w-16' : 'w-64')}>{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-64 bg-white dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button className="rounded p-1 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          {stores.length > 0 && (
            <select className="input !w-auto max-w-[50vw] !py-1.5" value={store?.id || ''} onChange={(e) => selectStore(e.target.value)} aria-label="Store">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div className="flex-1" />
          <div className="relative">
            <button className="relative rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setShowNotes(!showNotes)} aria-label="Notifications">
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
            </button>
            {showNotes && (
              <div className="card absolute right-0 top-11 z-40 w-80 max-w-[90vw] p-0">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm font-semibold dark:border-slate-800">
                  Alerts
                  {unread > 0 && <button className="text-xs font-normal text-brand-600" onClick={async () => { await api('/notifications/read-all', { body: {} }); setNotes(notes.map((n) => ({ ...n, read: true }))); }}>Mark all read</button>}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notes.length === 0 && <p className="p-4 text-sm text-slate-500">No alerts yet.</p>}
                  {notes.map((n) => (
                    <div key={n.id} className={cx('border-b border-slate-100 px-4 py-2 text-sm last:border-0 dark:border-slate-800', !n.read && 'bg-brand-50/50 dark:bg-brand-700/10')}>
                      <div className="font-medium">{n.title}</div><div className="text-slate-500">{n.body}</div><div className="text-xs text-slate-400">{ago(n.at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          <div className="hidden text-right text-xs sm:block"><div className="font-medium">{user?.email}</div><div className="capitalize text-slate-500">{user?.role}</div></div>
          <button className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
