import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { put } from '../../api';
import { Button, ErrorBox, inputClass } from '../../components/ui';
import { useApi } from '../../hooks';

export type Step = {
  id?: string;
  position: number;
  start: string;
  end: string;
  days: number[];
  checkpoint?: { id: string; label: string };
  checkpointId?: string;
};

type Draft = { checkpointId: string; start: string; end: string; days: number[] };

const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Éditeur de l'itinéraire de l'établissement (D14) : saisi une fois, le serveur le
 * recopie sur chaque élève (sans l'étape bus pour ceux qui ne prennent pas le bus).
 */
export function RouteEditor({ initial, onSaved }: { initial: Step[]; onSaved: () => void }) {
  const checkpoints = useApi<{ checkpoints: { id: string; label: string }[] }>(
    '/manager/checkpoints',
  );
  const [steps, setSteps] = useState<Draft[]>(
    initial.length > 0
      ? initial.map((s) => ({
          checkpointId: s.checkpoint?.id ?? '',
          start: s.start,
          end: s.end,
          days: s.days,
        }))
      : [{ checkpointId: '', start: '07:00', end: '07:45', days: [1, 2, 3, 4, 5] }],
  );
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<Draft>) =>
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await put('/manager/route', { steps });
          onSaved();
        } catch (err) {
          setError(err);
        } finally {
          setSaving(false);
        }
      }}
    >
      {steps.map((s, i) => (
        <fieldset key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">Étape {i + 1}</legend>
          <select
            className={inputClass}
            value={s.checkpointId}
            onChange={(e) => update(i, { checkpointId: e.target.value })}
            required
            aria-label="Point de contrôle"
          >
            <option value="">Point de contrôle</option>
            {checkpoints.data?.checkpoints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="time"
              className={inputClass}
              value={s.start}
              onChange={(e) => update(i, { start: e.target.value })}
              aria-label="Début"
              required
            />
            <span>à</span>
            <input
              type="time"
              className={inputClass}
              value={s.end}
              onChange={(e) => update(i, { end: e.target.value })}
              aria-label="Fin"
              required
            />
          </div>
          <div className="flex items-center gap-1">
            {DAY_LABELS.map((label, d) => {
              const day = d + 1;
              const on = s.days.includes(day);
              return (
                <button
                  type="button"
                  key={day}
                  aria-pressed={on}
                  onClick={() =>
                    update(i, { days: on ? s.days.filter((x) => x !== day) : [...s.days, day] })
                  }
                  className={`size-8 rounded-full text-xs font-medium ${on ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {label}
                </button>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              className="ml-auto !p-2"
              aria-label="Supprimer l’étape"
              onClick={() => setSteps(steps.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setSteps([
              ...steps,
              { checkpointId: '', start: '15:30', end: '16:15', days: [1, 2, 3, 4, 5] },
            ])
          }
        >
          <Plus className="size-4" aria-hidden />
          Étape
        </Button>
        <Button type="submit" loading={saving} disabled={steps.length === 0}>
          Enregistrer
        </Button>
      </div>
      <ErrorBox error={error} />
    </form>
  );
}
