import { ArrowLeft, CreditCard, Printer, RotateCcw } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { patch, post } from '../../api';
import { Button, Card, ErrorBox, inputClass, Pill, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';
import { BADGE_KIND, BADGE_STATUS, fmtDateTime } from '../../labels';
import { useEstablishment } from './ManagerLayout';
import { RouteEditor, type Step } from './RouteEditor';

type Badge = { id: string; kind: string; status: string; issuedAt: string; activatedAt: string | null; simulatedCard: { counter: number } | null };
type Student = {
  id: string;
  firstName: string;
  lastName: string;
  classroom: { name: string };
  parents: { id: string; name: string }[];
  badges: Badge[];
  route: { name: string; steps: Step[] } | null;
};
type IssueResult = {
  badge: { id: string; kind: string; status: string };
  printedCode?: string;
  nfcProgramming?: { metaKey: string; macKey: string; urlTemplate: string };
};

const DAYS = ['', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const LIVE = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED'];

export function StudentDetailPage() {
  const { id } = useParams();
  const { establishment, simulator } = useEstablishment();
  const { data, error, loading, reload } = useApi<{ student: Student }>(`/manager/students/${id}`);
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [editRoute, setEditRoute] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? 'Élève introuvable.'} />;
  const s = data.student;
  const live = s.badges.find((b) => LIVE.includes(b.status));

  const issue = (kind: 'NFC' | 'PRINTED', replaceReason?: 'LOST' | 'REVOKED') =>
    run(async () => setIssued(await post<IssueResult>(`/manager/students/${s.id}/badges`, { kind, replaceReason })));

  return (
    <>
      <Link to="/responsable/eleves" className="inline-flex items-center gap-1 text-sm text-teal-800">
        <ArrowLeft className="size-4" aria-hidden />Élèves
      </Link>
      <Card title={`${s.firstName} ${s.lastName}`}>
        <p className="text-sm text-slate-600">Classe : {s.classroom.name}</p>
        <p className="text-sm text-slate-600">Parents : {s.parents.map((p) => p.name).join(', ') || 'aucun'}</p>
      </Card>

      <Card title="Badge">
        <ErrorBox error={actionError} />
        {live ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Pill tone={live.status === 'ACTIVE' ? 'good' : 'warn'}>{BADGE_KIND[live.kind]} · {BADGE_STATUS[live.status]}</Pill>
              {live.simulatedCard && <Pill tone="info">Carte simulée (lecture n° {live.simulatedCard.counter})</Pill>}
              <span className="text-slate-500">Émis le {fmtDateTime(live.issuedAt)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {live.status === 'ACTIVE' && <Button variant="secondary" loading={busy} onClick={() => run(() => patch(`/manager/badges/${live.id}/status`, { status: 'SUSPENDED' }))}>Suspendre</Button>}
              {live.status === 'SUSPENDED' && <Button variant="secondary" loading={busy} onClick={() => run(() => patch(`/manager/badges/${live.id}/status`, { status: 'ACTIVE' }))}>Réactiver</Button>}
              {live.status !== 'PENDING_ACTIVATION' && (
                <Button variant="danger" loading={busy} onClick={() => issue('NFC', 'LOST')}>
                  <RotateCcw className="size-4" aria-hidden />Carte perdue : réémettre
                </Button>
              )}
              {live.status === 'PENDING_ACTIVATION' && simulator && (
                <Button variant="secondary" loading={busy} onClick={() => run(() => post(`/manager/badges/${live.id}/simulator`))}>
                  <CreditCard className="size-4" aria-hidden />Utiliser une carte simulée
                </Button>
              )}
            </div>
            {live.status === 'PENDING_ACTIVATION' && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => post(`/manager/badges/${live.id}/activate`, { rawCode: activationCode }));
                }}
              >
                <label className="block text-sm font-medium" htmlFor="activation">Activer une vraie carte : collez la première lecture (URL ou code)</label>
                <div className="flex gap-2">
                  <input id="activation" className={inputClass} value={activationCode} onChange={(e) => setActivationCode(e.target.value)} placeholder="https://.../c?p=...&c=..." />
                  <Button type="submit" disabled={!activationCode}>Activer</Button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} onClick={() => issue('NFC')}><CreditCard className="size-4" aria-hidden />Émettre une carte NFC</Button>
            {establishment.allowPrintedBadges && <Button variant="secondary" loading={busy} onClick={() => issue('PRINTED')}>Émettre une carte QR imprimée</Button>}
          </div>
        )}
        {issued?.nfcProgramming && <NfcKit kit={issued.nfcProgramming} />}
        {issued?.printedCode && <PrintedCard code={issued.printedCode} />}
        {s.badges.length > 1 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-slate-600">Historique des badges</summary>
            <ul className="mt-2 space-y-1">
              {s.badges.map((b) => (
                <li key={b.id}>{BADGE_KIND[b.kind]} · {BADGE_STATUS[b.status]} · émis le {fmtDateTime(b.issuedAt)}</li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Itinéraire" actions={<Button variant="secondary" className="!py-1.5" onClick={() => setEditRoute((v) => !v)}>{editRoute ? 'Fermer' : 'Modifier'}</Button>}>
        {editRoute ? (
          <RouteEditor studentId={s.id} initial={s.route} onSaved={() => { setEditRoute(false); reload(); }} />
        ) : s.route ? (
          <ol className="space-y-1 text-sm">
            {s.route.steps.map((st) => (
              <li key={st.id ?? st.position}>
                {st.position}. {st.checkpoint?.label} · {st.start} à {st.end} · {st.days.map((d) => DAYS[d]).join(' ')}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">Aucun itinéraire : aucune anomalie ne sera détectée pour cet élève.</p>
        )}
      </Card>
    </>
  );
}

/** Clés de programmation, affichées une seule fois. Voir docs/BADGES.md. */
function NfcKit({ kit }: { kit: NonNullable<IssueResult['nfcProgramming']> }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">Programmation de la carte NTAG 424 DNA (affiché une seule fois)</p>
      <p className="text-amber-900">Mode SUN avec PICCData chiffrée et SDMMAC. Clé méta (clé 1 / SDMMetaRead) et clé MAC (clé 2 / SDMFileRead) :</p>
      <code className="block break-all rounded bg-white p-2 text-xs">Clé méta : {kit.metaKey}</code>
      <code className="block break-all rounded bg-white p-2 text-xs">Clé MAC : {kit.macKey}</code>
      <code className="block break-all rounded bg-white p-2 text-xs">URL : {kit.urlTemplate}</code>
      <p className="text-xs text-amber-900">Ou bien choisissez « Utiliser une carte simulée » pour la démonstration.</p>
    </div>
  );
}

/** Carte QR imprimée : le secret n'est pas conservé par le serveur, imprimer maintenant. */
function PrintedCard({ code }: { code: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(code, { width: 320, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [code]);
  return (
    <div className="mt-3 space-y-2">
      <div id="printable-card" className="mx-auto w-[85.6mm] rounded-xl border-2 border-slate-800 bg-white p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Badge Passage</p>
        {src && <img src={src} alt="QR du badge" className="mx-auto my-2 w-40" />}
        <p className="text-[10px] text-slate-500">Carte non nominative. En cas de perte, la rapporter à l’établissement.</p>
      </div>
      <p className="text-center text-xs text-amber-800">Ce QR ne sera plus jamais affiché : imprimez-le maintenant.</p>
      <Button variant="secondary" className="mx-auto flex" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden />Imprimer
      </Button>
    </div>
  );
}
