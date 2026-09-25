import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  const requestGen = useRef(0);
  const userRef = useRef<AuthState["user"]>(null);
  userRef.current = user;

  async function loadProfileWithToken(uid: string, token: string): Promise<StudentProfile | null> {
    const gen = ++requestGen.current;
    try {
      const rows = await rest<StudentProfile[]>("profiles", `id=eq.${uid}&select=id,role,full_name`, token);
      let p = rows[0] ?? null;
      if (p?.role === "student") {
        const details = await rest<Array<Pick<StudentProfile, "phone_number" | "parent_name" | "parent_phone_number" | "profile_status" | "profile_submitted_at" | "profile_approved_at">>>(
          "student_profiles",
          `id=eq.${uid}&select=phone_number,parent_name,parent_phone_number,profile_status,profile_submitted_at,profile_approved_at`,
          token,
        );
        p = { ...p, ...(details[0] ?? { profile_status: "incomplete" }) };
      }
      if (requestGen.current !== gen) return userRef.current?.id === uid ? (p as StudentProfile | null) : null;
      // Preserve the last known profile if a background refresh fails; only
      // clear when this uid is no longer the active user.
      setProfile((prev) => {
        if (userRef.current?.id !== uid) return prev;
        return p;
      });
      return p;
    } catch {
      if (requestGen.current !== gen) return null;
      // Do not wipe a known profile on transient failures.
      return null;
    }
  }

  async function loadProfile(uid: string): Promise<StudentProfile | null> {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      return loadProfileWithToken(uid, token);
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (data.session?.user) {
        const currentUser = { id: data.session.user.id, email: data.session.user.email ?? "" };
        setUser(currentUser);
        await loadProfileWithToken(currentUser.id, data.session.access_token);
      } else {
        setUser(null);
        setProfile(null);
      }
      if (mounted) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT" || !session?.user) {
        requestGen.current++;
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      const nextUser = { id: session.user.id, email: session.user.email ?? "" };
      const prevUser = userRef.current;
      if (prevUser?.id === nextUser.id) {
        // Same user (tab refocus / token refresh): keep the route mounted.
        // Refresh the profile quietly in the background without global loading.
        setUser(nextUser);
        void loadProfileWithToken(nextUser.id, session.access_token);
        setLoading(false);
        return;
      }
      // Identity change: resolve the new profile before rendering protected content.
      requestGen.current++;
      setLoading(true);
      setUser(nextUser);
      setProfile(null);
      void loadProfileWithToken(nextUser.id, session.access_token).finally(() => {
        if (mounted) setLoading(false);
      });
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
    requestGen.current++;
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setLoading(false);
  }

  async function refreshProfile() {
    if (user) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) await loadProfileWithToken(user.id, token);
    }
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
