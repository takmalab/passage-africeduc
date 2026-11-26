-- Itinéraire défini par l'établissement, recopié sur chaque élève (DECISIONS.md, D14).
-- Généré avec `prisma migrate diff`, puis relu : les lignes qui supprimaient et
-- recréaient l'index partiel "Badge_one_live_per_student" ont été retirées (faux
-- écart de Prisma sur les index partiels, fonction en préversion).

-- Élève : prend-il le bus ? (vrai par défaut)
ALTER TABLE "Student" ADD COLUMN "takesBus" BOOLEAN NOT NULL DEFAULT true;

-- Itinéraire type de l'établissement.
CREATE TABLE "EstablishmentRouteStep" (
    "id" UUID NOT NULL,
    "establishmentId" UUID NOT NULL,
    "checkpointId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "days" INTEGER[],

    CONSTRAINT "EstablishmentRouteStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EstablishmentRouteStep_establishmentId_position_key" ON "EstablishmentRouteStep"("establishmentId", "position");
CREATE UNIQUE INDEX "EstablishmentRouteStep_establishmentId_checkpointId_key" ON "EstablishmentRouteStep"("establishmentId", "checkpointId");

ALTER TABLE "EstablishmentRouteStep" ADD CONSTRAINT "EstablishmentRouteStep_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EstablishmentRouteStep" ADD CONSTRAINT "EstablishmentRouteStep_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mêmes règles que pour les étapes d'un élève (migration integrity_constraints).
ALTER TABLE "EstablishmentRouteStep" ADD CONSTRAINT "EstablishmentRouteStep_window_check" CHECK (
  "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"
);
ALTER TABLE "EstablishmentRouteStep" ADD CONSTRAINT "EstablishmentRouteStep_days_check" CHECK (
  cardinality("days") >= 1 AND "days" <@ ARRAY[1,2,3,4,5,6,7]
);
ALTER TABLE "EstablishmentRouteStep" ADD CONSTRAINT "EstablishmentRouteStep_position_check" CHECK ("position" >= 1);
