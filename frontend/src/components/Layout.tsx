import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Search,
  MessageSquare,
  GitCompare,
  Settings,
  LogOut,
  Moon,
  Sun,
  Ticket,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useEffect, useState, type ComponentType } from 'react';

const STORAGE_COLLAPSED = 'ji-sidebar-collapsed';
const STORAGE_THEME = 'ji-theme';

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tickets', icon: Search, label: 'Ticket Search' },
  { to: '/similar', icon: GitCompare, label: 'Similar Explorer' },
  { to: '/chat', icon: MessageSquare, label: 'Duo Chat' },
  { to: '/admin', icon: Settings, label: 'Sync Settings' },
] as const;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_COLLAPSED) === 'true';
  } catch {
    return false;
  }
}

function readDark(): boolean {
  try {
    return localStorage.getItem(STORAGE_THEME) === 'dark';
  } catch {
    return false;
  }
}

function NavLink({
  to,
  icon: Icon,
  label,
  active,
  collapsed,
  onNavigate,
}: {
  to: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center rounded-lg text-sm font-medium transition-colors',
        collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {active && !collapsed && (
        <span
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-foreground/80"
          aria-hidden
        />
      )}
      <Icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-4 w-4')} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function SidebarAction({
  onClick,
  icon: Icon,
  label,
  collapsed,
}: {
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
  collapsed: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'flex w-full items-center rounded-lg text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
        collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'
      )}
    >
      <Icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-4 w-4')} />
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [dark, setDark] = useState(readDark);
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentPage =
    nav.find((n) => location.pathname === n.to || location.pathname.startsWith(n.to + '/'))?.label ||
    'Jira Intelligence';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(STORAGE_THEME, dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_COLLAPSED, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const closeMobile = () => setMobileOpen(false);
  const showCollapsed = collapsed && !mobileOpen;
  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  const sidebarContent = (
    <>
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b',
          showCollapsed ? 'justify-center px-2' : 'justify-between gap-2 px-4'
        )}
      >
        <Link
          to="/"
          className={cn('flex items-center gap-2.5 min-w-0', showCollapsed && 'justify-center')}
          onClick={closeMobile}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Ticket className="h-5 w-5" />
          </div>
          {!showCollapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight">Jira Intelligence</p>
              <p className="truncate text-[10px] text-muted-foreground uppercase tracking-wider">
                Ticket AI
              </p>
            </div>
          )}
        </Link>
        {!showCollapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-2">
        {nav.map((item) => {
          const active =
            location.pathname === item.to || location.pathname.startsWith(item.to + '/');
          return (
            <NavLink
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              active={active}
              collapsed={showCollapsed}
              onNavigate={closeMobile}
            />
          );
        })}
      </nav>

      <div className="shrink-0 border-t p-2 space-y-1">
        {showCollapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="hidden md:flex w-full items-center justify-center rounded-lg p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>
        )}
        <SidebarAction
          onClick={() => setDark(!dark)}
          icon={dark ? Sun : Moon}
          label={dark ? 'Light mode' : 'Dark mode'}
          collapsed={showCollapsed}
        />
        <SidebarAction onClick={logout} icon={LogOut} label="Logout" collapsed={showCollapsed} />
        {!showCollapsed && user && (
          <div className="mt-2 flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground capitalize">{user.role}</p>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label="Close menu"
          onClick={closeMobile}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card shadow-lg transition-[width,transform] duration-300 ease-in-out md:static md:shadow-none',
          showCollapsed ? 'w-[4.5rem]' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <button
          type="button"
          onClick={closeMobile}
          className="absolute right-2 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
        {sidebarContent}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-card/80 px-4 backdrop-blur-sm md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-accent md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="hidden md:flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-accent"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{currentPage}</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                AI-assisted Jira ticket intelligence
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-full border bg-muted/50 px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground sm:inline">
              {user?.role}
            </span>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 pl-1 pr-3 py-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-xs font-semibold text-primary">
                {initials}
              </div>
              <span className="hidden max-w-[140px] truncate text-sm font-medium md:inline">
                {user?.name}
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-auto bg-muted/20 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
