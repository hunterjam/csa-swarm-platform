'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'csa_active_session';

interface SessionContextValue {
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
}

const SessionContext = createContext<SessionContextValue>({
  activeSessionId: '',
  setActiveSessionId: () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [activeSessionId, setActiveSessionIdState] = useState('');

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) ?? '';
    if (stored) setActiveSessionIdState(stored);
  }, []);

  const setActiveSessionId = useCallback((id: string) => {
    setActiveSessionIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return (
    <SessionContext.Provider value={{ activeSessionId, setActiveSessionId }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
