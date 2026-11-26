import { Plus } from 'lucide-react';
import { useState } from 'react';
import { post } from '../../api';
import { Button, Card, Empty, ErrorBox, inputClass, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';

type Classroom = { id: string; name: string; _count: { students: number } };

/**
 * Classes de l'établissement : liste (avec le nombre d'élèves) et ajout.
 * Le serveur refuse un nom déjà pris (409) ; l'interface affiche son message.
 */
export function ClassroomsCard() {
  const list = useApi<{ classrooms: Classroom[] }>('/manager/classrooms');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <Card title="Classes">
      <ErrorBox error={list.error} />
      {list.loading ? (
        <Spinner />
      ) : list.data?.classrooms.length === 0 ? (
        <Empty>Aucune classe.</Empty>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100">
          {list.data?.classrooms.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="font-medium">{c.name}</span>
              <span className="text-slate-500">
                {c._count.students} élève{c._count.students > 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setSaving(true);
          try {
            await post('/manager/classrooms', { name });
            setName('');
            list.reload();
          } catch (err) {
            setError(err); // ex. « Une classe porte déjà ce nom. »
          } finally {
            setSaving(false);
          }
        }}
      >
        <input
          className={inputClass}
          placeholder="Nom (ex. 4e B)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          aria-label="Nom de la classe"
          required
        />
        <Button type="submit" loading={saving}>
          <Plus className="size-4" aria-hidden />
          Ajouter
        </Button>
      </form>
      <div className="mt-2">
        <ErrorBox error={error} />
      </div>
    </Card>
  );
}
