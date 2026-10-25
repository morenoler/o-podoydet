import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
const SESSION_CHANGED = "o-account-session-changed";

function announceSessionChange() {
  try {
    // Only an invalidation signal crosses tabs; no credentials or user data are stored here.
    localStorage.setItem(SESSION_CHANGED, crypto.randomUUID());
  } catch {
    /* Focus-based revalidation still works when browser storage is unavailable. */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const verifySession = useCallback(async (quiet = false) => {
    const request = ++generation.current;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const result = await authApi.me();
      if (request === generation.current) setUser(result.user);
    } catch (error) {
      if (request === generation.current) {
        // Do not keep a private account screen open after session verification fails.
        setUser(null);
        setError((error as Error).message);
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  const reload = useCallback(() => verifySession(), [verifySession]);
  useEffect(() => {
    void reload();
    const changed = (event: StorageEvent) => {
      if (event.key === SESSION_CHANGED) void reload();
    };
    // Refocusing the window must not destroy an unsaved form when the session is unchanged.
    const focused = () => { void verifySession(true); };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", focused);
    return () => {
      ++generation.current;
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", focused);
    };
  }, [reload, verifySession]);
  const acceptUser = (value: AccountUser | null) => {
    if (!value)
      throw new Error("Не удалось открыть кабинет. Попробуйте войти ещё раз.");
    ++generation.current;
    setUser(value);
    setError("");
    setLoading(false);
    announceSessionChange();
    return value;
  };
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        reload,
        login: async (email, password) => {
          ++generation.current;
          return acceptUser((await authApi.login(email, password)).user);
        },
        register: async (input) => {
          ++generation.current;
          return acceptUser((await authApi.register(input)).user);
        },
        logout: async () => {
          ++generation.current;
          await authApi.logout();
          ++generation.current;
          setUser(null);
          setLoading(false);
          announceSessionChange();
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
