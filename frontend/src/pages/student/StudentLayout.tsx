import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, BookOpen, FileText, House, LogOut, Menu, Target, UserRound, X } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { Spinner } from "../../components/ui";

const destinations = [
  { to: "/student/dashboard", label: "Dashboard", Icon: House },
  { to: "/student/practice", label: "Practice", Icon: Target },
  { to: "/student/tests", label: "Full-length tests", Icon: FileText },
  { to: "/student/results", label: "Review", Icon: BarChart3 },
  { to: "/student/vocabulary", label: "Vocabulary", Icon: BookOpen },
  { to: "/student/profile", label: "Profile", Icon: UserRound },
];

export default function StudentLayout() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLElement>(null);

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
      if (event.key !== "Tab" || !menuPanelRef.current) return;
      const items = Array.from(menuPanelRef.current.querySelectorAll<HTMLElement>("a, button"));
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <Spinner />;
  if (profile.role !== "student") return <Navigate to="/admin" replace />;

  const profileApproved = profile.profile_status === "approved";
  if (!profileApproved && location.pathname !== "/student/profile") {
    return <Navigate to="/student/profile" replace />;
  }

  const navItems = profileApproved ? destinations : destinations.filter((item) => item.to === "/student/profile");
  const activeItem = navItems.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  const navigation = (mobile: boolean) => navItems.map(({ to, label, Icon }) => (
    <NavLink
      key={to}
      to={to}
      end={to === "/student/dashboard"}
      className={({ isActive }) => `student-rail-link${isActive ? " active" : ""}`}
      aria-label={label}
      title={mobile ? undefined : label}
      onClick={mobile ? () => setMenuOpen(false) : undefined}
    >
      <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
      <span className="student-rail-label">{label}</span>
    </NavLink>
  ));

  const logout = () => void signOut().then(() => navigate("/login"));

  return (
    <div className="app-layout navy-shell luxe-shell">
      <aside className="student-rail" aria-label="Student navigation">
        <NavLink to="/student/dashboard" className="student-rail-brand" aria-label="Grit dashboard">G<span>.</span></NavLink>
        <nav className="student-rail-nav">{navigation(false)}</nav>
        <div className="student-rail-bottom">
          <button className="student-rail-link student-rail-signout" onClick={logout} aria-label="Sign out" title="Sign out">
            <LogOut size={20} strokeWidth={1.7} aria-hidden="true" />
            <span className="student-rail-label">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="student-workspace">
        <header className="student-topline">
          <div className="student-breadcrumb"><span>Grit</span><i aria-hidden="true" /><strong>{activeItem?.label ?? "Study"}</strong></div>
          <span className="student-account" title={profile.full_name ?? user.email ?? "Account"}>{profile.full_name ?? user.email}</span>
          <button ref={menuButtonRef} className="student-mobile-menu-button" type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="student-mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </header>

        {menuOpen && <button type="button" className="student-mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
        <nav ref={menuPanelRef} id="student-mobile-navigation" className={`student-mobile-navigation${menuOpen ? " is-open" : ""}`} aria-label="Student navigation" aria-hidden={!menuOpen}>
          <div className="student-mobile-nav-heading">Grit <button type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={20} /></button></div>
          {navigation(true)}
          <button className="student-rail-link student-mobile-signout" onClick={logout}><LogOut size={20} aria-hidden="true" /><span className="student-rail-label">Sign out</span></button>
        </nav>

        <main className="app-content student-content-stage">
          <div key={location.pathname} className="page-fade"><Outlet /></div>
        </main>
        <footer className="student-footer"><span>Grit</span><span>Practice with purpose.</span></footer>
      </div>
    </div>
  );
}
