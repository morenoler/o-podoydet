import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AccountRole, AccountUser } from "../../../shared/account";
import { authApi } from "./api";

interface AuthContextValue {
  user: AccountUser | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  login: (email: string, password: string) => Promise<AccountUser>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    role: AccountRole;
  }) => Promise<AccountUser>;
  logout: () => Promise<void>;
  updateUser: (user: AccountUser) => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setUser((await authApi.me()).user);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const acceptUser = (value: AccountUser | null) => {
    if (!value)
      throw new Error("Не удалось открыть кабинет. Попробуйте войти ещё раз.");
    setUser(value);
    setError("");
    return value;
  };
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        reload,
        login: async (email, password) =>
          acceptUser((await authApi.login(email, password)).user),
        register: async (input) =>
          acceptUser((await authApi.register(input)).user),
        logout: async () => {
          await authApi.logout();
          setUser(null);
        },
        updateUser: setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required");
  return context;
}

export function accountPath(user: Pick<AccountUser, "role">) {
  return user.role === "host" ? "/host" : "/account";
}
