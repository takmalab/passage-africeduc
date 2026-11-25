import { nfcUrlToCode } from '@passage/shared';

/**
 * Lecture des cartes NFC avec Web NFC.
 * Disponible uniquement dans Chrome sur Android, en HTTPS (ou localhost),
 * et après un geste de l'utilisateur (bouton). C'est la contrainte imposée à
 * l'agent de portail : un téléphone Android avec NFC (voir DECISIONS.md, D1).
 */

type NdefRecord = { recordType: string; data?: DataView; encoding?: string };
type NdefReadingEvent = Event & { message: { records: NdefRecord[] } };
type NdefReader = EventTarget & {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((event: NdefReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
};

export function isNfcSupported(): boolean {
  return typeof window !== 'undefined' && 'NDEFReader' in window;
}

/** Démarre la lecture ; `onCode` reçoit un code `PSG1.N...` à chaque carte posée. */
export async function startNfcReading(
  onCode: (code: string) => void,
  onError: (message: string) => void,
): Promise<() => void> {
  const Reader = (window as unknown as { NDEFReader: new () => NdefReader }).NDEFReader;
  const reader = new Reader();
  const controller = new AbortController();
  reader.onreading = (event) => {
    for (const record of event.message.records) {
      if (record.recordType !== 'url' || !record.data) continue;
      const url = new TextDecoder().decode(record.data);
      const code = nfcUrlToCode(url);
      if (code) onCode(code);
      else onError('Carte non reconnue.');
      return;
    }
    onError('Carte sans donnée Passage.');
  };
  reader.onreadingerror = () => onError('Lecture interrompue : reposez la carte.');
  await reader.scan({ signal: controller.signal });
  return () => controller.abort();
}
