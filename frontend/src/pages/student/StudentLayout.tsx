import { useEffect } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Spinner } from "../../components/ui";

function initials(name?: string | null, email?: string | null): string {
  const base = (name ?? email ?? "S").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (base[0] ?? "S").toUpperCase();
}

export default function StudentLayout() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => {
      const hdr = document.querySelector<HTMLElement>(".app-header");
      if (!hdr) return;
      if (window.scrollY > 8) hdr.classList.add("scrolled");
      else hdr.classList.remove("scrolled");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [location.pathname]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <Spinner />;
  if (profile.role !== "student") return <Navigate to="/admin" replace />;

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="brand">
          <span className="logo">S</span>
          <span>SAT Practice</span>
        </div>
        <nav className="student-nav">
          <NavLink to="/student/tests">Full-Length Tests</NavLink>
          <NavLink to="/student/practice">Practice</NavLink>
          <NavLink to="/student/results">Results</NavLink>
          <NavLink to="/student/vocabulary">Vocabulary</NavLink>
        </nav>
        <div className="user-chip">
          <span className="avatar">{initials(profile?.full_name, user.email)}</span>
          <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile?.full_name ?? user.email}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void signOut().then(() => navigate("/login"))}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="app-content">
        <div key={location.pathname} className="page-fade">
          <Outlet />
        </div>
      </div>
      <div className="footer-wrapper">
        <div className="footer-panel">
          <div className="footer-top">
            <div className="footer-brand">
              <div className="brand"><span className="logo">S</span> SAT Practice</div>
              <p>Focused test practice, score review, and vocabulary work in a calm exam-grade workspace.</p>
            </div>
            <div className="footer-links">
              <div className="footer-col">
                <h4>Study</h4>
                <Link to="/student/tests">Full-Length Tests</Link>
                <Link to="/student/practice">Practice</Link>
                <Link to="/student/vocabulary">Vocabulary</Link>
              </div>
              <div className="footer-col">
                <h4>Progress</h4>
                <Link to="/student/results">Results</Link>
                <Link to="/student/vocabulary">Streak</Link>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} SAT Practice</span>
            <span className="status-badge"><span className="status-dot" /> Ready for practice</span>
          </div>
        </div>
      </div>
    </div>
  );
}
