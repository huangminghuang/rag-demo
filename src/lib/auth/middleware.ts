import type { AuthUser } from "./session";
import { getCurrentUserFromCookies } from "./session";

export interface AuthContext {
  user: AuthUser | null;
}

export async function resolveAuthContext(): Promise<AuthContext> {
  const user = await getCurrentUserFromCookies();
  return { user };
}
