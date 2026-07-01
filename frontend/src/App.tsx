import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { TicketSearchPage } from '@/pages/TicketSearchPage';
import { TicketDetailPage } from '@/pages/TicketDetailPage';
import { ChatPage } from '@/pages/ChatPage';
import { SimilarExplorerPage } from '@/pages/SimilarExplorerPage';
import { AdminSyncPage } from '@/pages/AdminSyncPage';
import { SecurityDashboardPage } from '@/pages/SecurityDashboardPage';
import { SecurityScanDetailPage } from '@/pages/SecurityScanDetailPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
});

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="tickets" element={<TicketSearchPage />} />
        <Route path="tickets/:id" element={<TicketDetailPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="similar" element={<SimilarExplorerPage />} />
        <Route path="security" element={<SecurityDashboardPage />} />
        <Route path="security/scans/:id" element={<SecurityScanDetailPage />} />
        <Route path="admin" element={<AdminSyncPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
