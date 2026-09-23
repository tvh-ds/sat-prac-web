import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Spinner } from "../../components/ui";
import { LayoutDashboard, Users, FileUp, Database, ClipboardList, Layers, BookOpen, LogOut } from "lucide-react";

export default function AdminLayout() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.role !== "admin") return <Navigate to="/student" replace />;

  const link = (to: string, label: string, Icon: React.ElementType, end?: boolean) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? "active" : "")}>
      <Icon size={16} strokeWidth={1.6} />
      <span>{label}</span>
    </NavLink>
  );

  return (
    <div className="admin-layout">
      <div className="admin-sidebar">
        <div className="brand">
          <small>Admin console</small>
          SAT Practice
        </div>
        {link("/admin", "Dashboard", LayoutDashboard, true)}
        {link("/admin/students", "Students", Users)}
        {link("/admin/imports", "PDF Imports", FileUp)}
        {link("/admin/questions", "Practice Question Bank", Database)}
        {link("/admin/tests", "Full-Length Tests", ClipboardList)}
        {link("/admin/practice", "Practice Sets", Layers)}
        {link("/admin/vocabulary", "Vocabulary", BookOpen)}
        <div className="spacer" />
        <div className="sidebar-footer">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void signOut().then(() => navigate("/login"));
            }}
          >
            <LogOut size={16} strokeWidth={1.6} />
            <span>Sign out</span>
          </a>
        </div>
      </div>
      <div className="admin-main">
        <Outlet />
        <div className="footer-wrapper" style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0, marginTop: 40 }}>
          <div className="footer-panel">
            <div className="footer-top">
              <div className="footer-brand">
                <div className="brand"><span className="logo">S</span> SAT Practice</div>
                <p>Operational workspace for tests, question review, imports, students, and vocabulary.</p>
              </div>
              <div className="footer-links">
                <div className="footer-col">
                  <h4>Admin</h4>
                  <a href="/admin/students">Students</a>
                  <a href="/admin/imports">Imports</a>
                  <a href="/admin/questions">Questions</a>
                </div>
                <div className="footer-col">
                  <h4>Platform</h4>
                  <a href="/student/tests">Student View</a>
                  <a href="/admin/tests">Tests</a>
                  <a href="/admin/practice">Practice</a>
                </div>
              </div>
            </div>
            <div className="footer-bottom">
              <span>© {new Date().getFullYear()} SAT Practice · Self-hosted</span>
              <span className="status-badge"><span className="status-dot" /> Platform ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
