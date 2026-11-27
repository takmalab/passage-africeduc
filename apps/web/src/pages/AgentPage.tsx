import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  CloudOff,
  Keyboard,
  Nfc,
  QrCode,
  RefreshCw,
  Wifi,
  XCircle,
  Clock,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMinute, type SyncResponse } from '@passage/shared';
import { ApiError, get, NetworkError, post } from '../api';
import { useAuth } from '../auth';
import { Layout } from '../components/Layout';
import { Button, Card, ErrorBox, inputClass, Pill } from '../components/ui';
import { useOnline } from '../hooks';
import { fmtTime, refusalLabel } from '../labels';
import { db, getMeta, setMeta, type ScanResult } from '../offline/db';
import { SyncEngine } from '../offline/sync-engine';
import { isNfcSupported, startNfcReading } from '../scanner/nfc';
import { QrCamera } from '../scanner/QrCamera';
import { type CheckpointWindow, formatCountdown, windowStatus } from '../window-status';

type Checkpoint = {
  id: string;
  label: string;
  type: 'GATE' | 'BUS';
  window: CheckpointWindow | null;
};
type CheckpointsResponse = { checkpoints: Checkpoint[]; timezone: string; serverTime: number };
type Mode = 'nfc' | 'qr' | 'manual';

/** Au-delà de cet âge, un verdict n'est plus affiché en grand (scan fait hors ligne). */
const VERDICT_MAX_AGE_MS = 30_000;

const engine = new SyncEngine(db, (body) => post<SyncResponse>('/agent/sync', body));

/**
 * Écran de l'agent de portail. Fonctionne sans réseau : chaque lecture va
 * d'abord dans la file locale, puis part dès que le réseau le permet.
 */
export function AgentPage() {
  const online = useOnline();
  const { offline: authOffline } = useAuth();
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointId, setCheckpointId] = useState<string>('');
  const [mode, setMode] = useState<Mode>(isNfcSupported() ? 'nfc' : 'qr');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // Minuterie du message « Carte lue » : relancée à chaque lecture, pour qu'une carte lue
  // juste après la précédente garde son message affiché le temps prévu.
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Verdict du serveur affiché en grand (vert : accepté, rouge : refusé).
  const [verdict, setVerdict] = useState<ScanResult | null>(null);
  const verdictTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastVerdictId = useRef<string | null>(null);
  // Fuseau de l'école et décalage « heure serveur - heure du téléphone » (pour le compte à rebours).
  const [timezone, setTimezone] = useState('Africa/Douala');
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  const pending = useLiveQuery(() => db.queue.count(), [], 0);
  const results = useLiveQuery(
    () => db.results.orderBy('at').reverse().limit(15).toArray(),
    [],
    [],
  );

  // Quand le dernier scan reçoit son verdict, on l'affiche en grand. Seulement pour un scan
  // récent : au retour du réseau, les verdicts des scans faits hors ligne il y a longtemps
  // restent dans la liste « Derniers passages », sans surgir en plein écran.
  useEffect(() => {
    const latest = results?.[0];
    if (!latest || latest.status === 'pending' || lastVerdictId.current === latest.localEventId) {
      return;
    }
    lastVerdictId.current = latest.localEventId;
    if (Date.now() - latest.at > VERDICT_MAX_AGE_MS) return;
    // Réaction à un changement de la base locale (IndexedDB) : mise à jour d'état voulue.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerdict(latest);
    setFlash(null); // le verdict remplace « Carte lue »
    navigator.vibrate?.(latest.status === 'accepted' ? 80 : [200, 100, 200]);
    clearTimeout(verdictTimer.current);
    verdictTimer.current = setTimeout(() => setVerdict(null), 2500);
  }, [results]);

  // Points de contrôle : depuis le serveur si possible, sinon depuis le cache local.
  useEffect(() => {
    void (async () => {
      const cached = (await getMeta<Checkpoint[]>('checkpoints')) ?? [];
      setCheckpoints(cached);
      setTimezone((await getMeta<string>('timezone')) ?? 'Africa/Douala');
      setClockOffsetMs((await getMeta<number>('clockOffsetMs')) ?? 0);
      setCheckpointId((await getMeta<string>('checkpointId')) ?? cached[0]?.id ?? '');
      try {
        const res = await get<CheckpointsResponse>('/agent/checkpoints');
        const fresh = res.checkpoints;
        // Si l'horloge du téléphone est fausse, le compte à rebours suit quand même l'heure du serveur.
        const offset = res.serverTime - Date.now();
        setCheckpoints(fresh);
        setTimezone(res.timezone);
        setClockOffsetMs(offset);
        await setMeta('checkpoints', fresh);
        await setMeta('timezone', res.timezone);
        await setMeta('clockOffsetMs', offset);
        setCheckpointId((id) => id || fresh[0]?.id || '');
      } catch {
        /* hors ligne : on garde le cache */
      }
    })();
  }, []);

  const current = useMemo(
    () => checkpoints.find((c) => c.id === checkpointId),
    [checkpoints, checkpointId],
  );
  const label = current?.label ?? '';

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      await engine.flush();
      await engine.trimResults();
      setSyncError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSyncError(
          'Session expirée : reconnectez-vous pour envoyer les scans en attente. Ils restent sur ce téléphone.',
        );
      } else if (!(err instanceof NetworkError)) {
        setSyncError(err instanceof Error ? err.message : 'Échec de la synchronisation.');
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  // Synchronisation automatique : au retour du réseau, et toutes les 15 secondes.
  useEffect(() => {
    // Abonnement à un système externe (réseau) : premier envoi immédiat voulu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    window.addEventListener('online', sync);
    const timer = setInterval(sync, 15_000);
    return () => {
      window.removeEventListener('online', sync);
      clearInterval(timer);
    };
  }, [sync]);

  const onCode = useCallback(
    async (rawCode: string) => {
      if (!checkpointId) return;
      await engine.enqueue({ rawCode: rawCode.trim(), checkpointId }, label);
      setFlash('Carte lue');
      navigator.vibrate?.(80);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 1500);
      void sync();
    },
    [checkpointId, label, sync],
  );

  return (
    <Layout title="Agent de portail">
      <div className="flex flex-wrap items-center gap-2">
        {online ? (
          <Pill tone="good">
            <Wifi className="size-3.5" aria-hidden />
            En ligne
          </Pill>
        ) : (
          <Pill tone="warn">
            <CloudOff className="size-3.5" aria-hidden />
            Hors ligne : les scans sont gardés
          </Pill>
        )}
        <Pill tone={pending ? 'info' : 'neutral'}>
          <Clock className="size-3.5" aria-hidden />
          {pending} en attente d’envoi
        </Pill>
        {authOffline && <Pill tone="warn">Session non vérifiée (hors ligne)</Pill>}
        <Button
          variant="secondary"
          className="ml-auto !py-1.5"
          onClick={() => void sync()}
          loading={syncing}
          disabled={!online}
        >
          <RefreshCw className="size-4" aria-hidden />
          Synchroniser
        </Button>
      </div>
      <ErrorBox error={syncError} />

      <Card>
        <label className="mb-1 block text-sm font-medium" htmlFor="checkpoint">
          Point de contrôle
        </label>
        <select
          id="checkpoint"
          className={inputClass}
          value={checkpointId}
          onChange={(e) => {
            setCheckpointId(e.target.value);
            void setMeta('checkpointId', e.target.value);
          }}
        >
          {checkpoints.length === 0 && (
            <option value="">Aucun point en cache : connectez-vous une fois en ligne</option>
          )}
          {checkpoints.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        {current && (
          <WindowBanner window={current.window} timezone={timezone} clockOffsetMs={clockOffsetMs} />
        )}

        <div className="mt-4 grid grid-cols-3 gap-2" role="tablist" aria-label="Mode de lecture">
          <ModeButton
            active={mode === 'nfc'}
            onClick={() => setMode('nfc')}
            icon={<Nfc className="size-4" aria-hidden />}
            label="Carte NFC"
          />
          <ModeButton
            active={mode === 'qr'}
            onClick={() => setMode('qr')}
            icon={<QrCode className="size-4" aria-hidden />}
            label="QR"
          />
          <ModeButton
            active={mode === 'manual'}
            onClick={() => setMode('manual')}
            icon={<Keyboard className="size-4" aria-hidden />}
            label="Saisie"
          />
        </div>

        <div className="mt-4">
          {mode === 'nfc' && <NfcPanel onCode={onCode} disabled={!checkpointId} />}
          {mode === 'qr' && checkpointId && <QrCamera onCode={onCode} />}
          {mode === 'manual' && <ManualPanel onCode={onCode} disabled={!checkpointId} />}
        </div>
        {verdict && <VerdictOverlay result={verdict} />}
        {flash && !verdict && (
          // Grand message au centre de l'écran : lisible d'un coup d'œil au portail.
          <div
            role="status"
            aria-live="assertive"
            className="fixed inset-x-6 top-1/3 z-50 flex flex-col items-center gap-2 rounded-2xl bg-teal-700 p-6 text-center text-white shadow-2xl"
          >
            <CheckCircle2 className="size-16" aria-hidden />
            <p className="text-3xl font-bold">{flash}</p>
            <p className="text-base text-teal-50">
              {online
                ? 'Vérification par le serveur…'
                : 'Gardée sur le téléphone, envoi au retour du réseau'}
            </p>
          </div>
        )}
      </Card>

      <Card title="Derniers passages">
        <ul className="divide-y divide-slate-100">
          {results?.map((r) => (
            <li key={r.localEventId} className="flex items-center gap-3 py-2 text-sm">
              {r.status === 'accepted' && (
                <CheckCircle2 className="size-5 text-emerald-600" aria-label="Accepté" />
              )}
              {(r.status === 'refused' || r.status === 'invalid') && (
                <XCircle className="size-5 text-red-600" aria-label="Refusé" />
              )}
              {r.status === 'pending' && (
                <Clock className="size-5 text-sky-600" aria-label="En attente" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.status === 'accepted' && (r.firstName ?? 'Accepté')}
                  {r.status === 'pending' && 'En attente de vérification'}
                  {(r.status === 'refused' || r.status === 'invalid') && 'Refusé'}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {r.checkpointLabel} · {fmtTime(r.at)}
                  {r.reason && ` · ${refusalLabel(r.reason)}`}
                </p>
              </div>
            </li>
          ))}
          {results?.length === 0 && (
            <li className="py-4 text-center text-sm text-slate-500">Aucun scan pour l’instant.</li>
          )}
        </ul>
      </Card>
    </Layout>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm ${active ? 'border-teal-600 bg-teal-50 font-medium text-teal-800' : 'border-slate-300 text-slate-700'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function NfcPanel({ onCode, disabled }: { onCode: (c: string) => void; disabled: boolean }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  if (!isNfcSupported()) {
    return (
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Ce navigateur ne lit pas le NFC. Il faut Chrome sur un téléphone Android avec NFC, en HTTPS.
        Utilisez le mode QR pour le simulateur de carte.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-center">
      {!active ? (
        <Button
          className="w-full"
          disabled={disabled}
          onClick={async () => {
            try {
              stop.current = await startNfcReading(onCode, setError);
              setActive(true);
              setError(null);
            } catch {
              setError('Impossible de démarrer le NFC (autorisation refusée ou NFC désactivé).');
            }
          }}
        >
          <Nfc className="size-5" aria-hidden />
          Démarrer la lecture NFC
        </Button>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-teal-500 bg-teal-50 p-6">
          <Nfc className="mx-auto size-10 text-teal-700" aria-hidden />
          <p className="mt-2 font-medium text-teal-900">Approchez la carte du dos du téléphone</p>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function ManualPanel({ onCode, disabled }: { onCode: (c: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onCode(value.trim());
        setValue('');
      }}
    >
      <input
        className={inputClass}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Coller le code (PSG1...) ou l’URL lue"
        aria-label="Code du badge"
        autoComplete="off"
      />
      <Button type="submit" disabled={disabled || !value.trim()}>
        Valider
      </Button>
    </form>
  );
}

/**
 * Plage horaire du point choisi, avec compte à rebours mis à jour chaque seconde.
 * L'heure utilisée est celle du serveur (heure du téléphone + décalage mesuré).
 */
function WindowBanner({
  window: range,
  timezone,
  clockOffsetMs,
}: {
  window: CheckpointWindow | null;
  timezone: string;
  clockOffsetMs: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const status = windowStatus(now + clockOffsetMs, timezone, range);
  if (status.state === 'none' || !range) return null;
  const plage = `${formatMinute(range.startMinute)} – ${formatMinute(range.endMinute)}`;

  const tone =
    status.state === 'open'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
      : 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <p
      className={`mt-3 flex items-center gap-2 rounded-lg border p-2 text-sm ${tone}`}
      role="status"
    >
      <Clock className="size-4 shrink-0" aria-hidden />
      {status.state === 'open' && (
        <span>
          <span className="font-medium">Plage ouverte {plage}</span> · ferme dans{' '}
          <span className="font-mono font-semibold tabular-nums">
            {formatCountdown(status.seconds)}
          </span>
        </span>
      )}
      {status.state === 'before' && (
        <span>
          Plage {plage} · ouvre dans{' '}
          <span className="font-mono tabular-nums">{formatCountdown(status.seconds)}</span>
        </span>
      )}
      {status.state === 'closed' && <span>Plage terminée ({plage})</span>}
      {status.state === 'not-today' && <span>Pas de plage aujourd’hui ({plage})</span>}
    </p>
  );
}

/** Verdict en grand : prénom de l'élève (contrôle visuel par l'agent) ou motif du refus. */
function VerdictOverlay({ result }: { result: ScanResult }) {
  const accepted = result.status === 'accepted';
  return (
    <div
      role="alert"
      className={`fixed inset-x-6 top-1/3 z-50 flex flex-col items-center gap-2 rounded-2xl p-6 text-center text-white shadow-2xl ${accepted ? 'bg-emerald-600' : 'bg-red-600'}`}
    >
      {accepted ? (
        <CheckCircle2 className="size-16" aria-hidden />
      ) : (
        <XCircle className="size-16" aria-hidden />
      )}
      <p className="text-3xl font-bold">{accepted ? 'Acceptée' : 'Refusée'}</p>
      <p className="text-2xl font-semibold">
        {accepted ? (result.firstName ?? '') : refusalLabel(result.reason)}
      </p>
      <p className="text-base opacity-90">{result.checkpointLabel}</p>
    </div>
  );
}
