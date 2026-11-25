import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { del, post } from '../../api';
import { Button, Card, Empty, ErrorBox, inputClass, Pill, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import { EXCEPTION_TYPES } from '../../labels';
import { useToday } from './ManagerLayout';

type Exception = {
  id: string;
  date: string;
  type: string;
  reason: string | null;
  student: { firstName: string; lastName: string } | null;
};

export function ExceptionsPage() {
  const today = useToday();
  const list = useApi<{ exceptions: Exception[] }>(`/manager/exceptions?date=${today}`);
  const students = useApi<{ students: { id: string; firstName: string; lastName: string }[] }>(
    '/manager/students',
  );
  const [form, setForm] = useState({
    dateKey: today,
    type: 'JUSTIFIED_ABSENCE',
    studentId: '',
    reason: '',
  });
  const [error, setError] = useState<unknown>(null);

  return (
    <>
      <Card title="Exceptions à venir">
        <p className="mb-2 text-sm text-slate-600">
          Une exception suspend la détection d’anomalies liées à l’itinéraire pour la journée. Les
          alertes de sécurité du badge restent actives.
        </p>
        <ErrorBox error={list.error} />
        {list.loading ? (
          <Spinner />
        ) : list.data?.exceptions.length === 0 ? (
          <Empty>Aucune exception.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data?.exceptions.map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-2 text-sm">
                <Pill tone="info">{EXCEPTION_TYPES[x.type]}</Pill>
                <span>{x.date.slice(0, 10)}</span>
                <span className="font-medium">
                  {x.student
                    ? `${x.student.firstName} ${x.student.lastName}`
                    : 'Tout l’établissement'}
                </span>
                {x.reason && <span className="text-slate-500">{x.reason}</span>}
                <Button
                  variant="ghost"
                  className="ml-auto !p-2"
                  aria-label="Supprimer"
                  onClick={async () => {
                    await del(`/manager/exceptions/${x.id}`);
                    list.reload();
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Ajouter une exception">
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await post('/manager/exceptions', {
                dateKey: form.dateKey,
                type: form.type,
                studentId: form.type === 'HOLIDAY' ? null : form.studentId || null,
                reason: form.reason || null,
              });
              list.reload();
            } catch (err) {
              setError(err);
            }
          }}
        >
          <input
            type="date"
            className={inputClass}
            value={form.dateKey}
            onChange={(e) => setForm({ ...form, dateKey: e.target.value })}
            aria-label="Date"
            required
          />
          <select
            className={inputClass}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            aria-label="Type"
          >
            {Object.entries(EXCEPTION_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {form.type !== 'HOLIDAY' && (
            <select
              className={inputClass}
              value={form.studentId}
              onChange={(e) => setForm({ ...form, studentId: e.target.value })}
              aria-label="Élève"
              required
            >
              <option value="">Élève</option>
              {students.data?.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </select>
          )}
          <input
            className={inputClass}
            placeholder="Motif (facultatif)"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            maxLength={200}
            aria-label="Motif"
          />
          <Button type="submit">
            <Plus className="size-4" aria-hidden />
            Ajouter
          </Button>
        </form>
        <div className="mt-2">
          <ErrorBox error={error} />
        </div>
      </Card>
    </>
  );
}
