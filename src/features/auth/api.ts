import type {
  AccountRole,
  AccountUser,
  AuthResponse,
} from "../../../shared/account";
import { api } from "../../shared/api/client";

export const authApi = {
  me: () => api<AuthResponse>("/auth/me"),
  login: (email: string, password: string) =>
    api<AuthResponse>("/auth/login", { email, password }),
  register: (input: {
    name: string;
    email: string;
    password: string;
    role: AccountRole;
  }) => api<AuthResponse>("/auth/register", input),
  logout: () => api<{ ok: boolean }>("/auth/logout", {}),
  profile: (input: Pick<AccountUser, "name" | "phone" | "about">) =>
    api<AuthResponse>("/account/profile", input),
};
