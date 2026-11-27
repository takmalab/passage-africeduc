import QrScanner from 'qr-scanner';
import { useEffect, useRef, useState } from 'react';
import { createRepeatGuard } from './repeat-guard';

/**
 * Lecture de QR à la caméra : cartes QR imprimées et codes affichés par le
 * simulateur de carte NFC. La caméra exige HTTPS (ou localhost).
 */
export function QrCamera({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!video.current) return;
    // Un même QR n'est renvoyé qu'après avoir quitté la caméra pendant 3 s.
    const accept = createRepeatGuard(3000);
    const scanner = new QrScanner(
      video.current,
      (result) => {
        if (accept(result.data, Date.now())) onCode(result.data);
      },
      { returnDetailedScanResult: true, highlightScanRegion: true, maxScansPerSecond: 5 },
    );
    scanner
      .start()
      .catch(() => setError('Caméra indisponible (autorisation refusée ou page non sécurisée).'));
    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, [onCode]);

  return (
    <div className="space-y-2">
      <video
        ref={video}
        className="aspect-square w-full rounded-xl bg-slate-900 object-cover"
        muted
        playsInline
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
