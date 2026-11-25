import QrScanner from 'qr-scanner';
import { useEffect, useRef, useState } from 'react';

/**
 * Lecture de QR à la caméra : cartes QR imprimées et codes affichés par le
 * simulateur de carte NFC. La caméra exige HTTPS (ou localhost).
 */
export function QrCamera({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef<{ code: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!video.current) return;
    const scanner = new QrScanner(
      video.current,
      (result) => {
        // Évite de relire le même QR en boucle pendant qu'il reste devant la caméra.
        const now = Date.now();
        if (last.current && last.current.code === result.data && now - last.current.at < 3000)
          return;
        last.current = { code: result.data, at: now };
        onCode(result.data);
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
