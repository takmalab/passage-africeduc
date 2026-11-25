import { Copy, Nfc } from 'lucide-react';
import QRCode from 'qrcode';
import { useState } from 'react';
import { post } from '../../api';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui';
import { useApi } from '../../hooks';

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  classroom: { name: string };
  badge: { id: string; status: string; simulated: boolean } | null;
};

/**
 * Simulateur de carte NFC : produit exactement ce qu'une puce NTAG 424 DNA
 * écrirait à chaque lecture (mêmes clés, même calcul). Le code s'affiche en QR
 * pour être lu par le mode QR de l'écran agent. Utile pour la démonstration
 * sans matériel, et pour montrer qu'une photo du code est refusée.
 */
export function SimulatorPage() {
  const students = useApi<{ students: Student[] }>('/manager/students');
  const [current, setCurrent] = useState<{
    name: string;
    code: string;
    counter: number;
    qr: string;
  } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const tap = async (s: Student) => {
    setError(null);
    try {
      const res = await post<{ code: string; counter: number }>(
        `/manager/badges/${s.badge!.id}/simulator/tap`,
      );
      const qr = await QRCode.toDataURL(res.code, { width: 360, margin: 1 });
      setCurrent({ name: s.firstName, code: res.code, counter: res.counter, qr });
    } catch (err) {
      setError(err);
    }
  };

  const simulated =
    students.data?.students.filter((s) => s.badge?.simulated && s.badge.status === 'ACTIVE') ?? [];

  return (
    <>
      {current && (
        <Card title={`Carte de ${current.name} posée (lecture n° ${current.counter})`}>
          <img
            src={current.qr}
            alt="Code produit par la carte"
            className="mx-auto w-72 max-w-full"
          />
          <p className="mt-2 break-all rounded bg-slate-50 p-2 font-mono text-xs">{current.code}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(current.code)}
            >
              <Copy className="size-4" aria-hidden />
              Copier le code
            </Button>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Démonstration : scannez ce QR avec l’écran agent (accepté), puis photographiez-le et
            présentez la photo depuis un autre appareil (refusé : code déjà utilisé).
          </p>
        </Card>
      )}
      <Card title="Cartes simulées">
        <ErrorBox error={error ?? students.error} />
        {students.loading ? (
          <Spinner />
        ) : simulated.length === 0 ? (
          <Empty>Aucune carte simulée active.</Empty>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {simulated.map((s) => (
              <li key={s.id}>
                <Button
                  variant="secondary"
                  className="w-full !justify-start"
                  onClick={() => void tap(s)}
                >
                  <Nfc className="size-4" aria-hidden />
                  Poser la carte de {s.firstName} {s.lastName} ({s.classroom.name})
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
