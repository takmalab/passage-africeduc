import { ArrowLeft, ChevronRight, MessageSquare, Users } from 'lucide-react';
import { Link, Outlet, useParams } from 'react-router';
import { Layout } from '../../components/Layout';
import { Card, Empty, ErrorBox, Pill, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import { ANOMALY_LABELS, ANOMALY_STATUS, fmtDateTime } from '../../labels';

export function ParentLayout() {
  return (
    <Layout
      title="Espace parent"
      nav={[
        {
          to: '/parent',
          label: 'Mes enfants',
          icon: <Users className="size-4" aria-hidden />,
          end: true,
        },
        {
          to: '/parent/messages',
          label: 'Messages',
          icon: <MessageSquare className="size-4" aria-hidden />,
        },
      ]}
    >
      <Outlet />
    </Layout>
  );
}

type Child = { id: string; firstName: string; lastName: string; classroom: { name: string } };

export function ChildrenPage() {
  const { data, error, loading } = useApi<{ children: Child[] }>('/parent/children');
  return (
    <Card title="Mes enfants">
      <ErrorBox error={error} />
      {loading ? (
        <Spinner />
      ) : data?.children.length === 0 ? (
        <Empty>Aucun enfant rattaché à votre compte.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data?.children.map((c) => (
            <li key={c.id}>
              <Link
                to={`/parent/enfants/${c.id}`}
                className="flex items-center gap-2 py-3 text-sm hover:bg-slate-50"
              >
                <span className="flex-1 font-medium">
                  {c.firstName} {c.lastName}
                </span>
                <span className="text-slate-500">{c.classroom.name}</span>
                <ChevronRight className="size-4 text-slate-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type ChildDetail = {
  child: Child;
  passages: { id: string; effectiveTime: string; checkpoint: { label: string } }[];
  anomalies: { id: string; type: string; status: string; createdAt: string }[];
};

export function ChildPage() {
  const { id } = useParams();
  const { data, error, loading } = useApi<ChildDetail>(`/parent/children/${id}`);
  if (loading) return <Spinner />;
  return (
    <>
      <Link to="/parent" className="inline-flex items-center gap-1 text-sm text-teal-800">
        <ArrowLeft className="size-4" aria-hidden />
        Mes enfants
      </Link>
      <ErrorBox error={error} />
      {data && (
        <>
          <Card title={`${data.child.firstName} ${data.child.lastName}`}>
            <p className="text-sm text-slate-600">
              {data.child.classroom.name} · 14 derniers jours
            </p>
          </Card>
          <Card title="Anomalies">
            {data.anomalies.length === 0 ? (
              <Empty>Aucune anomalie.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.anomalies.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Pill tone="warn">{ANOMALY_LABELS[a.type]}</Pill>
                    <span className="text-slate-600">{fmtDateTime(a.createdAt)}</span>
                    <Pill>{ANOMALY_STATUS[a.status]}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Passages">
            {data.passages.length === 0 ? (
              <Empty>Aucun passage.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.passages.map((p) => (
                  <li key={p.id} className="flex justify-between py-2 text-sm">
                    <span>{p.checkpoint.label}</span>
                    <span className="text-slate-600">{fmtDateTime(p.effectiveTime)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

export function MessagesPage() {
  const { data, error, loading } = useApi<{
    messages: { id: string; body: string; kind: string; createdAt: string }[];
  }>('/parent/messages');
  return (
    <Card title="Messages reçus">
      <ErrorBox error={error} />
      {loading ? (
        <Spinner />
      ) : data?.messages.length === 0 ? (
        <Empty>Aucun message.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data?.messages.map((m) => (
            <li key={m.id} className="space-y-1 py-3 text-sm">
              <p className="text-xs text-slate-500">
                {fmtDateTime(m.createdAt)}
                {m.kind === 'CORRECTION' ? ' · Rectification' : ''}
              </p>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
