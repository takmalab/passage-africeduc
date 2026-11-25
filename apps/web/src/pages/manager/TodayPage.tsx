import { Check, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { patch } from '../../api';
import { Button, Card, Empty, ErrorBox, inputClass, Pill, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import {
  ANOMALY_LABELS,
  ANOMALY_STATUS,
  CLOCK_LABELS,
  fmtDateTime,
  fmtTime,
  MESSAGE_STATUS,
  refusalLabel,
} from '../../labels';
import { useToday } from './ManagerLayout';

type Person = { id?: string; firstName: string; lastName: string };
type Anomaly = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  resolutionNote: string | null;
  details: { checkpointLabel?: string; minute?: number };
  student: Person;
  _count: { messages: number };
};
type Passage = {
  id: string;
  effectiveTime: string;
  deviceLocalTime: string;
  clockStatus: string;
  verdict: string;
  refusalReason: string | null;
  checkpoint: { label: string };
  student: Person | null;
  badge: { kind: string } | null;
};
type Message = {
  id: string;
  kind: string;
  body: string;
  status: string;
  suppressionReason: string | null;
  createdAt: string;
  parent: { name: string };
  student: Person;
};

export function TodayPage() {
  const today = useToday();
  const [date, setDate] = useState(today);
  const q = `?date=${date}`;
  const anomalies = useApi<{ anomalies: Anomaly[] }>(`/manager/anomalies${q}`);
  const passages = useApi<{ passages: Passage[] }>(`/manager/passages${q}`);
  const messages = useApi<{ messages: Message[] }>(`/manager/messages${q}`);
  const [error, setError] = useState<unknown>(null);

  const setStatus = async (id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') => {
    try {
      await patch(`/manager/anomalies/${id}`, { status });
      anomalies.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <label htmlFor="date" className="text-sm font-medium">
          Journée
        </label>
        <input
          id="date"
          type="date"
          className={`${inputClass} max-w-48`}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <ErrorBox error={error ?? anomalies.error ?? passages.error ?? messages.error} />

      <Card title={`Anomalies (${anomalies.data?.anomalies.length ?? 0})`}>
        {anomalies.loading ? (
          <Spinner />
        ) : anomalies.data?.anomalies.length === 0 ? (
          <Empty>Aucune anomalie ce jour-là.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {anomalies.data?.anomalies.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <Pill
                  tone={a.type === 'BADGE_REPLAY' || a.type === 'INACTIVE_BADGE' ? 'bad' : 'warn'}
                >
                  {ANOMALY_LABELS[a.type]}
                </Pill>
                <span className="font-medium">
                  {a.student.firstName} {a.student.lastName}
                </span>
                <span className="text-slate-500">
                  {a.details.checkpointLabel}
                  {a.details.minute != null &&
                    ` · ${String(Math.floor(a.details.minute / 60)).padStart(2, '0')}:${String(a.details.minute % 60).padStart(2, '0')}`}
                </span>
                <Pill tone={a.status === 'OPEN' ? 'info' : 'neutral'}>
                  {ANOMALY_STATUS[a.status]}
                </Pill>
                {a.resolutionNote && (
                  <span className="w-full text-xs text-slate-500">{a.resolutionNote}</span>
                )}
                <span className="ml-auto flex gap-1">
                  {a.status === 'OPEN' && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1"
                      onClick={() => void setStatus(a.id, 'ACKNOWLEDGED')}
                    >
                      <Check className="size-4" aria-hidden />
                      Vue
                    </Button>
                  )}
                  {(a.status === 'OPEN' || a.status === 'ACKNOWLEDGED') && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1"
                      onClick={() => void setStatus(a.id, 'RESOLVED')}
                    >
                      <CheckCheck className="size-4" aria-hidden />
                      Résolue
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Passages (${passages.data?.passages.length ?? 0})`}>
        {passages.loading ? (
          <Spinner />
        ) : passages.data?.passages.length === 0 ? (
          <Empty>Aucun passage.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Heure retenue</th>
                  <th className="pr-3">Élève</th>
                  <th className="pr-3">Point</th>
                  <th className="pr-3">Verdict</th>
                  <th>Horloge</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {passages.data?.passages.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5 pr-3">{fmtTime(p.effectiveTime)}</td>
                    <td className="pr-3">
                      {p.student ? `${p.student.firstName} ${p.student.lastName}` : 'Inconnu'}
                    </td>
                    <td className="pr-3">{p.checkpoint.label}</td>
                    <td className="pr-3">
                      {p.verdict === 'ACCEPTED' ? (
                        <Pill tone="good">Accepté</Pill>
                      ) : (
                        <Pill tone="bad">{refusalLabel(p.refusalReason)}</Pill>
                      )}
                    </td>
                    <td title={`Heure brute de l’appareil : ${fmtDateTime(p.deviceLocalTime)}`}>
                      <Pill tone={p.clockStatus === 'OK' ? 'neutral' : 'warn'}>
                        {CLOCK_LABELS[p.clockStatus]}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Messages aux parents (${messages.data?.messages.length ?? 0})`}>
        {messages.loading ? (
          <Spinner />
        ) : messages.data?.messages.length === 0 ? (
          <Empty>Aucun message.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {messages.data?.messages.map((m) => (
              <li key={m.id} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill
                    tone={
                      m.status === 'SENT'
                        ? 'good'
                        : m.status === 'SUPPRESSED' || m.status === 'FAILED'
                          ? 'warn'
                          : 'info'
                    }
                  >
                    {MESSAGE_STATUS[m.status]}
                  </Pill>
                  {m.kind === 'CORRECTION' && <Pill tone="info">Rectification</Pill>}
                  <span className="text-slate-500">
                    À : {m.parent.name} · {fmtTime(m.createdAt)}
                  </span>
                </div>
                <p>{m.body}</p>
                {m.suppressionReason && (
                  <p className="text-xs text-amber-800">{m.suppressionReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
