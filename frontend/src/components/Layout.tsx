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
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tickets', icon: Search, label: 'Ticket Search' },
  { to: '/similar', icon: GitCompare, label: 'Similar Explorer' },
  { to: '/chat', icon: MessageSquare, label: 'Duo Chat' },
  { to: '/admin', icon: Settings, label: 'Sync Settings' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [dark, setDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'border-r bg-card transition-all duration-300 flex flex-col',
          sidebarOpen ? 'w-64' : 'w-16'
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b px-4">
          <Ticket className="h-6 w-6 text-primary shrink-0" />
          {sidebarOpen && (
            <span className="font-bold text-sm truncate">Jira Intelligence</span>
          )}
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {nav.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {sidebarOpen && item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-2 space-y-1">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            <span className="text-xs">{sidebarOpen ? 'Collapse' : '»'}</span>
          </button>
          <button
            onClick={() => setDark(!dark)}
            className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {sidebarOpen && (dark ? 'Light mode' : 'Dark mode')}
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            {sidebarOpen && 'Logout'}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="h-16 border-b flex items-center justify-between px-6 bg-card/50">
          <h1 className="text-lg font-semibold">
            {nav.find((n) => location.pathname === n.to || location.pathname.startsWith(n.to + '/'))?.label || 'Jira Intelligence'}
          </h1>
          <div className="text-sm text-muted-foreground">
            {user?.name} ({user?.role})
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
