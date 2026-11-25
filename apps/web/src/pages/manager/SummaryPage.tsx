import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { post } from '../../api';
import { Button, Card, ErrorBox, inputClass, Pill, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import { fmtDateTime, ORIGIN_LABELS } from '../../labels';
import { useToday } from './ManagerLayout';

type Summary = {
  text: string;
  origin: string;
  fallbackReason: string | null;
  fromCache: boolean;
  model: string | null;
  notice: string | null;
  facts: Record<string, number | string | string[] | boolean>;
};
type Usage = {
  budgetUsd: number;
  spentTodayUsd: number;
  model: string;
  keyConfigured: boolean;
  calls: {
    id: string;
    createdAt: string;
    status: string;
    attempt: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    durationMs: number;
    errorMessage: string | null;
  }[];
};

const FACT_LABELS: Record<string, string> = {
  enrolled: 'Élèves inscrits',
  present: 'Présents',
  excused: 'Absences justifiées',
  late: 'Retards au premier point',
  outOfWindow: 'Passages hors plage',
  outOfWindowTimes: 'Heures hors plage',
  missed: 'Passages manquants',
  badgeAlerts: 'Alertes badge',
};

export function SummaryPage() {
  const today = useToday();
  const classrooms = useApi<{ classrooms: { id: string; name: string }[] }>('/manager/classrooms');
  const usage = useApi<Usage>('/manager/ai/usage');
  const [classroomId, setClassroomId] = useState('');
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  return (
    <>
      <Card title="Synthèse du jour">
        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError(null);
            try {
              const res = await post<{ summary: Summary }>('/manager/summaries', {
                classroomId,
                dateKey: date,
              });
              setSummary(res.summary);
              usage.reload();
            } catch (err) {
              setError(err);
            } finally {
              setLoading(false);
            }
          }}
        >
          <select
            className={inputClass}
            value={classroomId}
            onChange={(e) => setClassroomId(e.target.value)}
            required
            aria-label="Classe"
          >
            <option value="">Classe</option>
            {classrooms.data?.classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
            required
          />
          <Button type="submit" loading={loading}>
            <Sparkles className="size-4" aria-hidden />
            Générer
          </Button>
        </form>
        <div className="mt-3">
          <ErrorBox error={error} />
        </div>

        {summary && (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg bg-slate-50 p-3 text-base leading-relaxed">{summary.text}</p>
            <div className="flex flex-wrap gap-2">
              <Pill tone={summary.origin === 'TEMPLATE' ? 'warn' : 'good'}>
                {ORIGIN_LABELS[summary.origin]}
              </Pill>
              {summary.fromCache && <Pill tone="info">Cache : non facturé</Pill>}
              {summary.model && <Pill>{summary.model}</Pill>}
            </div>
            {summary.notice && <p className="text-sm text-amber-800">{summary.notice}</p>}
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">
                Chiffres calculés par le code (seule source des nombres)
              </summary>
              <table className="mt-2 text-left">
                <tbody>
                  {Object.entries(FACT_LABELS).map(([k, label]) => (
                    <tr key={k}>
                      <td className="pr-4 text-slate-500">{label}</td>
                      <td>
                        {Array.isArray(summary.facts[k])
                          ? (summary.facts[k] as string[]).join(', ') || 'aucune'
                          : String(summary.facts[k])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}
      </Card>

      <Card title="Consommation IA">
        {!usage.data ? (
          <Spinner />
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Pill tone={usage.data.keyConfigured ? 'good' : 'warn'}>
                {usage.data.keyConfigured
                  ? `Clé configurée (${usage.data.model})`
                  : 'Aucune clé : mode dégradé'}
              </Pill>
              <Pill tone={usage.data.spentTodayUsd >= usage.data.budgetUsd ? 'bad' : 'neutral'}>
                Dépense du jour : {usage.data.spentTodayUsd.toFixed(5)} $ /{' '}
                {usage.data.budgetUsd.toFixed(2)} $
              </Pill>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="pr-3">Date</th>
                    <th className="pr-3">Statut</th>
                    <th className="pr-3">Essai</th>
                    <th className="pr-3">Tokens</th>
                    <th className="pr-3">Coût</th>
                    <th>Durée</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usage.data.calls.map((c) => (
                    <tr key={c.id} title={c.errorMessage ?? ''}>
                      <td className="py-1 pr-3">{fmtDateTime(c.createdAt)}</td>
                      <td className="pr-3">{c.status}</td>
                      <td className="pr-3">{c.attempt}</td>
                      <td className="pr-3">
                        {c.inputTokens} / {c.outputTokens}
                      </td>
                      <td className="pr-3">{c.estimatedCostUsd.toFixed(6)} $</td>
                      <td>{c.durationMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
