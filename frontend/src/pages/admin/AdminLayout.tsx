import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Spinner } from "../../components/ui";
import { Users, FileUp, Database, ClipboardList, Layers, BookOpen, ClipboardCheck, LogOut } from "lucide-react";

export default function AdminLayout() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <Spinner />;
  if (profile.role !== "admin") return <Navigate to="/student" replace />;

  const link = (to: string, label: string, Icon: React.ElementType, end?: boolean) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? "active" : "")}>
      <Icon size={16} strokeWidth={1.6} />
      <span>{label}</span>
    </NavLink>
  );

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="brand">
          <span className="admin-wordmark">Grit</span>
          <small>Workspace</small>
        </div>
        <nav className="admin-nav" aria-label="Admin navigation">
          {link("/admin/students", "Students", Users)}
          {link("/admin/imports", "PDF Imports", FileUp)}
          {link("/admin/questions", "Practice Question Bank", Database)}
          {link("/admin/tests", "Full-Length Tests", ClipboardList)}
          {link("/admin/practice", "Practice Sets", Layers)}
          {link("/admin/assignments", "Assignments", ClipboardCheck)}
          {link("/admin/vocabulary", "Vocabulary", BookOpen)}
        </nav>
        <div className="spacer" />
        <div className="sidebar-footer">
          <button type="button" onClick={() => void signOut().then(() => navigate("/login"))}>
            <LogOut size={16} strokeWidth={1.6} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <div className="admin-workspace-topline"><span>Grit / Operations</span><span>{profile.full_name ?? user.email}</span></div>
        <Outlet />
      </div>
    </div>
  );
}
