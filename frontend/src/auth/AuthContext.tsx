import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, rest } from "../lib/supabase";
import type { StudentProfile } from "../lib/types";

interface AuthState {
  loading: boolean;
  user: { id: string; email: string } | null;
  profile: StudentProfile | null;
  signIn: (email: string, password: string) => Promise<StudentProfile | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);

  async function loadProfile(uid: string): Promise<StudentProfile | null> {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      const rows = await rest<StudentProfile[]>("profiles", `id=eq.${uid}&select=id,role,full_name`, token);
      const p = rows[0] ?? null;
      setProfile(p);
      return p;
    } catch {
      setProfile(null);
      return null;
    }
  }

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) {
        const currentUser = { id: data.session.user.id, email: data.session.user.email ?? "" };
        if (mounted) setUser(currentUser);
        await loadProfile(currentUser.id);
      } else if (mounted) {
        setUser(null);
        setProfile(null);
      }
      if (mounted) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoading(true);
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? "" });
        void loadProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return null;
    return loadProfile(uid);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id);
  }

  return (
    <AuthContext.Provider value={{ loading, user, profile, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
