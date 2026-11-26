import { Card, Empty, ErrorBox, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import { NewAccountForm } from './NewAccountForm';

type Agent = { id: string; name: string; login: string };

/** Agents de l'établissement : liste et création de compte. */
export function AgentsCard() {
  const list = useApi<{ agents: Agent[] }>('/manager/agents');

  return (
    <Card title="Agents">
      <ErrorBox error={list.error} />
      {list.loading ? (
        <Spinner />
      ) : list.data?.agents.length === 0 ? (
        <Empty>Aucun agent.</Empty>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100">
          {list.data?.agents.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="font-medium">{a.name}</span>
              <span className="text-slate-500">{a.login}</span>
            </li>
          ))}
        </ul>
      )}
      <NewAccountForm path="/manager/agents" submitLabel="Créer" onCreated={list.reload} />
    </Card>
  );
}
