import { useState } from 'react';
import { patch } from '../../api';
import { Card, ErrorBox } from '../../components/ui';
import { useEstablishment } from './ManagerLayout';

export function SettingsPage() {
  const { establishment, reload } = useEstablishment();
  const [error, setError] = useState<unknown>(null);

  return (
    <Card title="Paramètres de l’établissement">
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">Établissement</dt><dd>{establishment.name}</dd>
        <dt className="text-slate-500">Fuseau horaire</dt><dd>{establishment.timezone}</dd>
      </dl>
      <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-teal-700"
          checked={establishment.allowPrintedBadges}
          onChange={async (e) => {
            try {
              await patch('/manager/establishment', { allowPrintedBadges: e.target.checked });
              reload();
            } catch (err) {
              setError(err);
            }
          }}
        />
        <span className="text-sm">
          <span className="font-medium">Autoriser les cartes QR imprimées</span>
          <span className="block text-slate-600">
            Pratique pour démarrer sans cartes NFC, mais moins sûr : une photo du QR peut être réutilisée une fois. Une copie
            utilisée sur deux appareils proches dans le temps est signalée comme anomalie.
          </span>
        </span>
      </label>
      <div className="mt-2"><ErrorBox error={error} /></div>
    </Card>
  );
}
