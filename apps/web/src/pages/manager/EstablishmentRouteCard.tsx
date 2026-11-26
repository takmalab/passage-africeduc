import { Card, ErrorBox, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import { RouteEditor, type Step } from './RouteEditor';

/**
 * Itinéraire de l'établissement (Paramètres) : portail entrée, portail sortie, et
 * autobus si l'école en dispose. Enregistrer le recopie sur tous les élèves.
 */
export function EstablishmentRouteCard() {
  const route = useApi<{ steps: Step[] }>('/manager/route');

  return (
    <Card title="Itinéraire de l’établissement">
      <p className="mb-3 text-sm text-slate-600">
        Saisi une seule fois, il s’applique à tous les élèves, y compris aux nouveaux. Les étapes
        d’autobus ne concernent pas les élèves marqués « Ne prend pas le bus » sur leur fiche.
      </p>
      <ErrorBox error={route.error} />
      {route.loading || !route.data ? (
        <Spinner />
      ) : (
        // key : l'éditeur repart des données enregistrées après chaque sauvegarde.
        <RouteEditor
          key={route.data.steps.map((s) => s.id).join()}
          initial={route.data.steps}
          onSaved={route.reload}
        />
      )}
    </Card>
  );
}
