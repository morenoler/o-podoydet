import { SiteHeader } from "./SiteHeader";
import { useAuth } from "../../features/auth/AuthProvider";
export function Header() {
  const { user, loading, logout } = useAuth();
  return (
    <SiteHeader
      accounts
      laboratory={import.meta.env.VITE_LAB_MODE === "true"}
      user={user}
      loading={loading}
      onLogout={logout}
    />
  );
}
