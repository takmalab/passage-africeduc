-- Contraintes d'intégrité que le schéma Prisma ne sait pas exprimer.
-- Prisma Migrate ne les supprime pas : elles restent actives après chaque migration.

-- Un badge NFC n'a pas de secret imprimé, une carte imprimée n'a pas d'UID de puce.
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_kind_material_check" CHECK (
  ("kind" = 'NFC' AND "staticSecretHash" IS NULL)
  OR ("kind" = 'PRINTED' AND "uidHash" IS NULL AND "staticSecretHash" IS NOT NULL)
);

-- Un badge actif ou suspendu a forcément son matériel d'authentification.
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_active_has_material_check" CHECK (
  "status" IN ('PENDING_ACTIVATION', 'LOST', 'REVOKED')
  OR "uidHash" IS NOT NULL
  OR "staticSecretHash" IS NOT NULL
);

-- Un badge ne peut pas se remplacer lui-même.
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_no_self_replace_check" CHECK ("replacesBadgeId" IS NULL OR "replacesBadgeId" <> "id");

-- Les compteurs de lecture NFC sont positifs.
ALTER TABLE "BadgeCodeUse" ADD CONSTRAINT "BadgeCodeUse_counter_check" CHECK ("counter" >= 0);

-- Fenêtres horaires valides : 00:00 <= début < fin <= 24:00, jours ISO 1 à 7, au moins un jour.
ALTER TABLE "RouteStep" ADD CONSTRAINT "RouteStep_window_check" CHECK (
  "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"
);
ALTER TABLE "RouteStep" ADD CONSTRAINT "RouteStep_days_check" CHECK (
  cardinality("days") >= 1 AND "days" <@ ARRAY[1,2,3,4,5,6,7]
);
ALTER TABLE "RouteStep" ADD CONSTRAINT "RouteStep_position_check" CHECK ("position" >= 1);

-- Un jour férié concerne tout l'établissement ; les autres exceptions, un élève.
ALTER TABLE "DayException" ADD CONSTRAINT "DayException_scope_check" CHECK (
  ("type" = 'HOLIDAY' AND "studentId" IS NULL) OR ("type" <> 'HOLIDAY' AND "studentId" IS NOT NULL)
);

-- Un passage accepté est forcément rattaché à un badge et à un élève ; un refus a un motif.
ALTER TABLE "Passage" ADD CONSTRAINT "Passage_verdict_check" CHECK (
  ("verdict" = 'ACCEPTED' AND "badgeId" IS NOT NULL AND "studentId" IS NOT NULL AND "refusalReason" IS NULL)
  OR ("verdict" = 'REFUSED' AND "refusalReason" IS NOT NULL)
);

-- Un message non émis porte toujours son motif.
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_suppression_check" CHECK (
  "status" <> 'SUPPRESSED' OR "suppressionReason" IS NOT NULL
);

-- Coûts et volumes IA jamais négatifs.
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_non_negative_check" CHECK (
  "inputTokens" >= 0 AND "outputTokens" >= 0 AND "estimatedCostUsd" >= 0 AND "durationMs" >= 0
);
