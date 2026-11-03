import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from './firebase';
import { api, getStoreId, setStoreId } from './api';
import type { AppUser, ShopOrder } from '../../../shared/types';

export interface StoreLite { id: string; name: string; baseUrl: string; currency: string }

interface Session {
  fbUser: User | null;
  user: AppUser | null;
  stores: StoreLite[];
  store: StoreLite | null;
  ready: boolean;
  error: string | null;
  isAdmin: boolean;
  selectStore: (id: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  // shared, lightly cached orders list (several pages use it)
  orders: ShopOrder[] | null;
  ordersError: string | null;
  loadOrders: (force?: boolean) => Promise<void>;
}

const Ctx = createContext<Session>(null as any);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [stores, setStores] = useState<StoreLite[]>([]);
  const [storeId, setSid] = useState(getStoreId());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<ShopOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [ordersAt, setOrdersAt] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: AppUser; stores: StoreLite[] }>('/me');
      setUser(me.user); setStores(me.stores); setError(null);
      const keep = me.stores.find((s) => s.id === getStoreId());
      const sid = keep ? keep.id : me.stores[0]?.id || '';
      setStoreId(sid); setSid(sid);
    } catch (e) { setUser(null); setError((e as Error).message); }
  }, []);

  useEffect(() => {
    if (!auth) { setReady(true); return; }
    return onAuthStateChanged(auth, async (u) => {
      setFbUser(u);
      if (u) await refresh(); else { setUser(null); setStores([]); }
      setReady(true);
    });
  }, [refresh]);

  const loadOrders = useCallback(async (force = false) => {
    if (!force && orders && Date.now() - ordersAt < 60_000) return;
    try { const r = await api<{ orders: ShopOrder[] }>('/orders'); setOrders(r.orders); setOrdersError(null); setOrdersAt(Date.now()); }
    catch (e) { setOrdersError((e as Error).message); }
  }, [orders, ordersAt]);

  const selectStore = (id: string) => { setStoreId(id); setSid(id); setOrders(null); setOrdersAt(0); };
  const store = stores.find((s) => s.id === storeId) || null;

  return (
    <Ctx.Provider value={{
      fbUser, user, stores, store, ready, error, isAdmin: user?.role === 'admin', selectStore, refresh,
      logout: async () => { if (auth) await signOut(auth); }, orders, ordersError, loadOrders,
    }}>
      {children}
    </Ctx.Provider>
  );
}
