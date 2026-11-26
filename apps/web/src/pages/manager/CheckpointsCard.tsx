import { Plus } from 'lucide-react';
import { useState } from 'react';
import { post } from '../../api';
import { Button, Card, Empty, ErrorBox, inputClass, Pill, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import { CHECKPOINT_TYPES } from '../../labels';

type Checkpoint = { id: string; label: string; type: string };

/**
 * Points de contrôle de l'établissement (portails, arrêts de bus) : liste et ajout.
 * Le serveur vérifie le rôle, valide les champs et refuse un nom déjà pris (409) ;
 * l'interface se contente d'afficher son message.
 */
export function CheckpointsCard() {
  const list = useApi<{ checkpoints: Checkpoint[] }>('/manager/checkpoints');
  const [form, setForm] = useState({ label: '', type: 'GATE' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <Card title="Points de contrôle">
      <p className="mb-2 text-sm text-slate-600">
        Les téléphones des agents récupèrent cette liste à la prochaine connexion au réseau.
      </p>
      <ErrorBox error={list.error} />
      {list.loading ? (
        <Spinner />
      ) : list.data?.checkpoints.length === 0 ? (
        <Empty>Aucun point de contrôle.</Empty>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100">
          {list.data?.checkpoints.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
              <Pill tone="info">{CHECKPOINT_TYPES[c.type]}</Pill>
              <span className="font-medium">{c.label}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={async (e) => {
          e.preventDefault(); // pas de rechargement de page : on envoie en JSON
          setError(null);
          setSaving(true);
          try {
            await post('/manager/checkpoints', { label: form.label, type: form.type });
            setForm({ ...form, label: '' }); // vide le champ pour le point suivant
            list.reload();
          } catch (err) {
            setError(err); // ex. « Un point de contrôle porte déjà ce nom. »
          } finally {
            setSaving(false);
          }
        }}
      >
        <input
          className={inputClass}
          placeholder="Nom (ex. Arrêt Bonapriso)"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          maxLength={80}
          aria-label="Nom du point de contrôle"
          required
        />
        <select
          className={inputClass}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
          aria-label="Type"
        >
          {Object.entries(CHECKPOINT_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
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
