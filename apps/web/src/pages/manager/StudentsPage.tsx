import { ChevronRight, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { post } from '../../api';
import { Button, Card, Empty, ErrorBox, inputClass, Pill, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import { BADGE_KIND, BADGE_STATUS } from '../../labels';

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  classroom: { id: string; name: string };
  badge: { id: string; kind: string; status: string; simulated: boolean } | null;
};
type Classroom = { id: string; name: string };

export function StudentsPage() {
  const students = useApi<{ students: Student[] }>('/manager/students');
  const classrooms = useApi<{ classrooms: Classroom[] }>('/manager/classrooms');
  const [form, setForm] = useState({ firstName: '', lastName: '', classroomId: '' });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Card title="Élèves">
        <ErrorBox error={students.error} />
        {students.loading ? (
          <Spinner />
        ) : students.data?.students.length === 0 ? (
          <Empty>Aucun élève.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {students.data?.students.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/responsable/eleves/${s.id}`}
                  className="flex items-center gap-3 py-2.5 text-sm hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {s.firstName} {s.lastName}
                    </p>
                    <p className="text-xs text-slate-500">{s.classroom.name}</p>
                  </div>
                  {s.badge ? (
                    <Pill tone={s.badge.status === 'ACTIVE' ? 'good' : 'warn'}>
                      {BADGE_KIND[s.badge.kind]} · {BADGE_STATUS[s.badge.status]}
                      {s.badge.simulated ? ' (simulée)' : ''}
                    </Pill>
                  ) : (
                    <Pill tone="bad">Sans badge</Pill>
                  )}
                  <ChevronRight className="size-4 text-slate-400" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Ajouter un élève">
        <form
          className="grid gap-2 sm:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError(null);
            try {
              await post('/manager/students', form);
              setForm({ firstName: '', lastName: '', classroomId: form.classroomId });
              students.reload();
            } catch (err) {
              setError(err);
            } finally {
              setSaving(false);
            }
          }}
        >
          <input
            className={inputClass}
            placeholder="Prénom"
            aria-label="Prénom"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            required
            maxLength={80}
          />
          <input
            className={inputClass}
            placeholder="Nom"
            aria-label="Nom"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            required
            maxLength={80}
          />
          <select
            className={inputClass}
            aria-label="Classe"
            value={form.classroomId}
            onChange={(e) => setForm({ ...form, classroomId: e.target.value })}
            required
          >
            <option value="">Classe</option>
            {classrooms.data?.classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button type="submit" loading={saving}>
            <UserPlus className="size-4" aria-hidden />
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
