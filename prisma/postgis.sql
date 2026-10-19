-- Ejecutar después de prisma db push. La geometría es derivada y no se escribe desde Prisma.
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE "Pivot" ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)
GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
CREATE INDEX IF NOT EXISTS pivot_location_gist ON "Pivot" USING GIST (location);
