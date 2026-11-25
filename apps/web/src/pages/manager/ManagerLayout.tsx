import { CalendarOff, CreditCard, LayoutDashboard, Settings, Sparkles, Users } from 'lucide-react';
import { createContext, useContext } from 'react';
import { Outlet } from 'react-router';
import { Layout } from '../../components/Layout';
import { ErrorBox, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';

type EstablishmentInfo = {
  establishment: { id: string; name: string; timezone: string; allowPrintedBadges: boolean };
  today: string;
  simulator: boolean;
};

const EstablishmentContext = createContext<(EstablishmentInfo & { reload: () => void }) | null>(
  null,
);

export const useEstablishment = () => {
  const ctx = useContext(EstablishmentContext);
  if (!ctx) throw new Error('Hors de ManagerLayout');
  return ctx;
};
export const useToday = () => useEstablishment().today;

const icon = 'size-4';

export function ManagerLayout() {
  const { data, error, reload } = useApi<EstablishmentInfo>('/manager/establishment');
  const nav = [
    {
      to: '/responsable',
      label: 'Journée',
      icon: <LayoutDashboard className={icon} aria-hidden />,
      end: true,
    },
    {
      to: '/responsable/eleves',
      label: 'Élèves et badges',
      icon: <Users className={icon} aria-hidden />,
    },
    {
      to: '/responsable/exceptions',
      label: 'Exceptions',
      icon: <CalendarOff className={icon} aria-hidden />,
    },
    {
      to: '/responsable/synthese',
      label: 'Synthèse IA',
      icon: <Sparkles className={icon} aria-hidden />,
    },
    ...(data?.simulator
      ? [
          {
            to: '/responsable/simulateur',
            label: 'Simulateur de carte',
            icon: <CreditCard className={icon} aria-hidden />,
          },
        ]
      : []),
    {
      to: '/responsable/parametres',
      label: 'Paramètres',
      icon: <Settings className={icon} aria-hidden />,
    },
  ];
  return (
    <Layout title={data?.establishment.name ?? 'Responsable'} nav={nav}>
      <ErrorBox error={error} />
      {!data ? (
        <Spinner />
      ) : (
        <EstablishmentContext.Provider value={{ ...data, reload }}>
          <Outlet />
        </EstablishmentContext.Provider>
      )}
    </Layout>
  );
}
