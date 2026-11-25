import { Navigate, Route, Routes } from 'react-router';
import { useAuth, type Role } from './auth';
import { Spinner } from './components/ui';
import { AgentPage } from './pages/AgentPage';
import { LoginPage } from './pages/LoginPage';
import { ExceptionsPage } from './pages/manager/ExceptionsPage';
import { ManagerLayout } from './pages/manager/ManagerLayout';
import { SettingsPage } from './pages/manager/SettingsPage';
import { SimulatorPage } from './pages/manager/SimulatorPage';
import { StudentDetailPage } from './pages/manager/StudentDetailPage';
import { StudentsPage } from './pages/manager/StudentsPage';
import { SummaryPage } from './pages/manager/SummaryPage';
import { TodayPage } from './pages/manager/TodayPage';
import { ChildPage, ChildrenPage, MessagesPage, ParentLayout } from './pages/parent/ParentPages';

const HOME: Record<Role, string> = { AGENT: '/agent', MANAGER: '/responsable', PARENT: '/parent' };

/**
 * Routage par rôle. Ce n'est qu'un confort d'affichage : le serveur vérifie le
 * rôle à chaque requête (un parent qui ouvre /responsable obtient des 403).
 */
export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <LoginPage />;

  const only = (role: Role, element: React.ReactNode) => (user.role === role ? element : <Navigate to={HOME[user.role]} replace />);

  return (
    <Routes>
      <Route path="/agent" element={only('AGENT', <AgentPage />)} />
      <Route path="/responsable" element={only('MANAGER', <ManagerLayout />)}>
        <Route index element={<TodayPage />} />
        <Route path="eleves" element={<StudentsPage />} />
        <Route path="eleves/:id" element={<StudentDetailPage />} />
        <Route path="exceptions" element={<ExceptionsPage />} />
        <Route path="synthese" element={<SummaryPage />} />
        <Route path="simulateur" element={<SimulatorPage />} />
        <Route path="parametres" element={<SettingsPage />} />
      </Route>
      <Route path="/parent" element={only('PARENT', <ParentLayout />)}>
        <Route index element={<ChildrenPage />} />
        <Route path="enfants/:id" element={<ChildPage />} />
        <Route path="messages" element={<MessagesPage />} />
      </Route>
      <Route path="*" element={<Navigate to={HOME[user.role]} replace />} />
    </Routes>
  );
}
