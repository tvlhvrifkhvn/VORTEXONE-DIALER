import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { CampaignProvider, useCampaign } from './hooks/useCampaign';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DialerSession from './pages/DialerSession';
import SmsTemplates from './pages/SmsTemplates';
import Inbox from './pages/Inbox';
import CallScreen from './pages/CallScreen';
import ManualCall from './pages/ManualCall';
import LeadDetail from './pages/LeadDetail';
import Import from './pages/Import';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Campaigns from './pages/Campaigns';
import Pipeline from './pages/Pipeline';
import Today from './pages/Today';
import Styleguide from './pages/Styleguide';

function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return children;
}

function AppRoutes() {
  // C1E: switching the file changes `version`; the key remounts every page.
  const { version } = useCampaign();
  return (
    <Routes key={version}>
      <Route path="/login" element={<Login />} />
      {/* C3B: Today is home; the leads list moved to /leads. */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <Today />
          </RequireAuth>
        }
      />
      <Route
        path="/leads"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/pipeline"
        element={
          <RequireAuth>
            <Pipeline />
          </RequireAuth>
        }
      />
      <Route
        path="/dialer"
        element={
          <RequireAuth>
            <DialerSession />
          </RequireAuth>
        }
      />
      <Route
        path="/sms/templates"
        element={
          <RequireAuth>
            <SmsTemplates />
          </RequireAuth>
        }
      />
      <Route
        path="/inbox"
        element={
          <RequireAuth>
            <Inbox />
          </RequireAuth>
        }
      />
      {/* Must precede /call/:leadId, which would otherwise match "manual"
          as a lead id. */}
      <Route
        path="/call/manual"
        element={
          <RequireAuth>
            <ManualCall />
          </RequireAuth>
        }
      />
      <Route
        path="/call/:leadId"
        element={
          <RequireAuth>
            <CallScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/leads/:id"
        element={
          <RequireAuth>
            <LeadDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/import"
        element={
          <RequireAuth>
            <Import />
          </RequireAuth>
        }
      />
      <Route
        path="/reports"
        element={
          <RequireAuth>
            <Reports />
          </RequireAuth>
        }
      />
      <Route
        path="/styleguide"
        element={
          <RequireAuth>
            <Styleguide />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/campaigns"
        element={
          <RequireAuth>
            <Campaigns />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Settings />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CampaignProvider>
        <AppRoutes />
      </CampaignProvider>
    </AuthProvider>
  );
}
