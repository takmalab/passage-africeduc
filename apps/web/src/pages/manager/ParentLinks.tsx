import { Link2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { del, post } from '../../api';
import { Button, ErrorBox, inputClass } from '../../components/ui';
import { useApi } from '../../hooks';

type Parent = { id: string; name: string; login?: string };

/**
 * Parents d'un élève : liste, retrait d'un lien, et lien d'un parent déjà connu
 * de l'établissement (frère ou sœur). Le serveur vérifie tout (établissement,
 * rôle PARENT, lien en double) ; l'interface n'est qu'un confort.
 */
export function ParentLinks({
  studentId,
  parents,
  onChanged,
}: {
  studentId: string;
  parents: Parent[];
  onChanged: () => void;
}) {
  // Parents liés à au moins un élève de l'établissement (jamais ceux d'une autre école).
  const known = useApi<{ parents: Parent[] }>('/manager/parents');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<unknown>(null);

  const linkedIds = new Set(parents.map((p) => p.id));
  const candidates = known.data?.parents.filter((p) => !linkedIds.has(p.id)) ?? [];

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged(); // recharge la fiche élève
      known.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="mt-2 space-y-2 text-sm">
      <p className="text-slate-600">Parents :{parents.length === 0 && ' aucun'}</p>
      <ul className="divide-y divide-slate-100">
        {parents.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-1.5">
            <span className="font-medium">{p.name}</span>
            <Button
              variant="ghost"
              className="ml-auto !px-2 !py-1"
              onClick={() => {
                // Retirer un lien coupe immédiatement l'accès du parent à cet élève.
                if (window.confirm(`Retirer l’accès de ${p.name} à cet élève ?`)) {
                  void run(() => del(`/manager/students/${studentId}/parents/${p.id}`));
                }
              }}
            >
              <Unlink className="size-4" aria-hidden />
              Retirer
            </Button>
          </li>
        ))}
      </ul>
      {candidates.length > 0 && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await post(`/manager/students/${studentId}/parents/link`, { parentId: selected });
              setSelected('');
            });
          }}
        >
          <select
            className={inputClass}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Parent déjà inscrit"
            required
          >
            <option value="">Lier un parent déjà inscrit (frère, sœur)</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.login})
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            <Link2 className="size-4" aria-hidden />
            Lier
          </Button>
        </form>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
