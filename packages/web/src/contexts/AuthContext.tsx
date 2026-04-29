import { useState, useEffect, createContext, useContext, ReactNode } from 'react';

interface User {
  id: string;
  username: string;
  role: 'admin' | 'developer';
}

interface AuthContextType {
  apiKey: string | null;
  user: User | null;
  login: (key: string) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(localStorage.getItem('qunkins_api_key'));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (apiKey) {
      verifyKey(apiKey).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [apiKey]);

  const verifyKey = async (key: string) => {
    try {
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${key}` }
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        return true;
      } else {
        logout();
        return false;
      }
    } catch {
      logout();
      return false;
    }
  };

  const login = async (key: string) => {
    const valid = await verifyKey(key);
    if (valid) {
      localStorage.setItem('qunkins_api_key', key);
      setApiKey(key);
    }
    return valid;
  };

  const logout = () => {
    localStorage.removeItem('qunkins_api_key');
    setApiKey(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ apiKey, user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
