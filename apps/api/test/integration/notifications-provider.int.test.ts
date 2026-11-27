import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { dispatchPending } from '../../src/modules/notifications/notifications.service.js';
import {
  setProvider,
  type NotificationProvider,
  type OutgoingMessage,
} from '../../src/modules/notifications/provider.js';
import { runSchedulerTick } from '../../src/worker/scheduler.js';
import { localTime, seedWorld } from './helpers.js';

// Le fournisseur d'envoi (SMS, WhatsApp...) est isolé derrière l'interface
// NotificationProvider : on peut le remplacer sans toucher au reste du code.

const DAY = '2026-11-24'; // un mardi
const nineAm = () => new Date(localTime(DAY, 9, 0));

describe("fournisseur d'envoi des messages aux parents", () => {
  it('un autre fournisseur (faux SMS) se branche sans rien changer au reste', async () => {
    const received: OutgoingMessage[] = [];
    // Toute classe qui respecte l'interface convient : c'est le seul point à écrire.
    const fakeSms: NotificationProvider = {
      name: 'faux-sms',
      async send(message) {
        received.push(message);
      },
    };
    setProvider(fakeSms);

    await seedWorld();
    await runSchedulerTick(nineAm()); // détecte les absences et envoie les messages

    const sent = await prisma.outboundMessage.findMany({ where: { status: 'SENT' } });
    expect(sent.length).toBeGreaterThan(0);
    expect(received.map((m) => m.id).sort()).toEqual(sent.map((m) => m.id).sort());
    expect(sent.every((m) => m.provider === 'faux-sms')).toBe(true);
  });

  it('fournisseur en panne : nouvel essai, erreur notée, puis échec définitif au 3e essai, sans planter', async () => {
    const down: NotificationProvider = {
      name: 'sms-en-panne',
      async send() {
        throw new Error('Opérateur SMS injoignable');
      },
    };
    setProvider(down);

    await seedWorld();
    // 1er essai, pendant le passage du programme de fond : il ne doit pas échouer.
    await expect(runSchedulerTick(nineAm())).resolves.toEqual({ ran: true });
    let messages = await prisma.outboundMessage.findMany();
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(m).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        lastError: 'Opérateur SMS injoignable',
      });
    }

    // 2e et 3e essais : au 3e, le message passe en échec définitif.
    await dispatchPending();
    await dispatchPending();
    messages = await prisma.outboundMessage.findMany();
    for (const m of messages) {
      expect(m).toMatchObject({ status: 'FAILED', attempts: 3 });
      expect(m.sentAt).toBeNull();
    }
    // Un message en échec n'est plus retenté.
    expect(await dispatchPending()).toBe(0);
  });
});
