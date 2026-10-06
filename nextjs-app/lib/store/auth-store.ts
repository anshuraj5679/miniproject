import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string) => Promise<void>;
  clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: async (user, token) => {
        set({ user, token, isAuthenticated: true });
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_token', token);
          try {
            await fetch('/api/auth/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token,
                userType: user.userType || 'consumer',
              }),
              credentials: 'include',
              keepalive: true,
            });
          } catch (error) {
            console.error('Failed to persist secure auth session:', error);
          }
        }
      },
      clearAuth: async () => {
        set({ user: null, token: null, isAuthenticated: false });
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth_token');
          try {
            await fetch('/api/auth/session', {
              method: 'DELETE',
              credentials: 'include',
              keepalive: true,
            });
          } catch (error) {
            console.error('Failed to clear secure auth session:', error);
          }
        }
      },
    }),
    {
      name: 'auth-storage',
      storage: typeof window !== 'undefined' ? createJSONStorage(() => localStorage) : (undefined as unknown as ReturnType<typeof createJSONStorage>),
      skipHydration: true,
    }
  )
);

