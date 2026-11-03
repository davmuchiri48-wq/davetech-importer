import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import './index.css';
import { SessionProvider, useSession } from './lib/session';
import { UiProvider } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Overview from './pages/Overview';
import FindProducts from './pages/FindProducts';
import Importer from './pages/Importer';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Pricing from './pages/Pricing';
import Sync from './pages/Sync';
import { Orders, SupplierOrders, Shipping, Customers, Payments } from './pages/Orders';
import Automation from './pages/Automation';
import Analytics from './pages/Analytics';
import Integrations, { ConnectStore } from './pages/Integrations';
import SettingsPage from './pages/Settings';

if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark');
}

function Gate() {
  const { ready, user, stores, isAdmin } = useSession();
  if (!ready) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>;
  if (!user) return <Login />;
  if (!stores.length) {
    return (
      <div className="mx-auto mt-12 max-w-xl p-4">
        {isAdmin ? <ConnectStore first /> : <p className="card p-6 text-sm">You don't have access to any store yet. Ask an administrator to add you.</p>}
      </div>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="find" element={<FindProducts />} />
        <Route path="import" element={<Importer />} />
        <Route path="products" element={<Products />} />
        <Route path="products/:id" element={<Products />} />
        <Route path="categories" element={<Categories />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="sync" element={<Sync />} />
        <Route path="orders" element={<Orders />} />
        <Route path="supplier-orders" element={<SupplierOrders />} />
        <Route path="shipping" element={<Shipping />} />
        <Route path="customers" element={<Customers />} />
        <Route path="payments" element={<Payments />} />
        <Route path="automation" element={<Automation />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <UiProvider>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </UiProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
