import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { DatabaseRecord } from "./database";
import type { State } from "./store";
import { defaultRules, addDays } from "@/domain/types";
export const stateNamespaces = [
  "settings",
  "pivot",
  "forecast",
  "ensemble",
  "ensemble-failure",
  "climate",
  "climate-feature",
  "seasonal",
  "observation",
];
export const archiveNamespaces = [
  "prediction",
  "outcome",
  "verification-refresh",
];
export const planningNamespaces = [
  "settings",
  "pivot",
  "ensemble",
  "ensemble-failure",
  "climate",
  "seasonal",
];
export const id = (parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export function makeRecord(
  namespace: string,
  key: string,
  value: unknown,
  metadata: Partial<DatabaseRecord> = {},
): DatabaseRecord {
  const data = JSON.stringify(value);
  if (data === undefined)
    throw new Error("No se puede guardar un registro vacío.");
  return {
    namespace,
    key,
    payload: gzipSync(data),
    hash: createHash("sha256").update(data).digest("hex"),
    updatedAt: Date.now(),
    expiresAt: null,
    ...metadata,
  };
}
export function unpack<T = any>(row: DatabaseRecord): T {
  return JSON.parse(gunzipSync(row.payload).toString());
}
export function emptyState(): State {
  return { pivots: [], rules: { ...defaultRules }, forecasts: {} };
}
export function encodeState(s: State): DatabaseRecord[] {
  const records = [makeRecord("settings", "rules", s.rules)];
  s.pivots.forEach((pivot, position) =>
    records.push(makeRecord("pivot", pivot.id, { pivot, position })),
  );
  const maps = {
    forecast: s.forecasts,
    ensemble: s.ensembles,
    "ensemble-failure": s.ensembleFailures,
    climate: s.climate,
    seasonal: s.seasonal,
  };
  for (const [ns, values] of Object.entries(maps))
    for (const [key, value] of Object.entries(values ?? {})) {
      if (ns === "climate") {
        const { features, ...summary } = value as NonNullable<
          State["climate"]
        >[string];
        records.push(makeRecord(ns, key, summary));
        if (features)
          records.push(makeRecord("climate-feature", key, features));
      } else
        records.push(
          makeRecord(
            ns,
            key,
            value,
            ns === "forecast"
              ? { validDate: (value as State["forecasts"][string]).fetchedAt }
              : {},
          ),
        );
    }
  for (const o of s.observations ?? [])
    records.push(makeRecord("observation", o.id, o));
  const a = s.validationArchive;
  for (const p of a?.predictions ?? [])
    records.push(
      makeRecord("prediction", id([p.key, p.date, p.lead, p.signature]), p, {
        location: p.key,
        validDate: p.date,
        lead: p.lead,
        signature: p.signature,
        expiresAt: Date.parse(addDays(p.date, 61) + "T00:00Z"),
      }),
    );
  for (const o of a?.outcomes ?? [])
    records.push(
      makeRecord("outcome", id([o.key, o.date, o.signature]), o, {
        location: o.key,
        validDate: o.date,
        signature: o.signature,
        expiresAt: Date.parse(addDays(o.date, 61) + "T00:00Z"),
      }),
    );
  for (const [key, time] of Object.entries(a?.refreshed ?? {}))
    records.push(makeRecord("verification-refresh", key, time));
  return records;
}
export function decodeState(rows: DatabaseRecord[]): State {
  const s = emptyState(),
    pivots: { pivot: State["pivots"][number]; position: number }[] = [];
  const mapping = {
    forecast: "forecasts",
    ensemble: "ensembles",
    "ensemble-failure": "ensembleFailures",
    climate: "climate",
    seasonal: "seasonal",
  } as const;
  for (const row of rows) {
    const value = unpack(row);
    if (row.namespace === "settings" && row.key === "rules")
      s.rules = { ...defaultRules, ...value };
    else if (row.namespace === "pivot") pivots.push(value);
    else if (row.namespace in mapping) {
      const name = mapping[row.namespace as keyof typeof mapping];
      ((s as any)[name] ??= {})[row.key] = value;
    } else if (row.namespace === "observation")
      (s.observations ??= []).push(value);
    else if (row.namespace === "prediction")
      (s.validationArchive ??= {
        predictions: [],
        outcomes: [],
      }).predictions.push(value);
    else if (row.namespace === "outcome")
      (s.validationArchive ??= { predictions: [], outcomes: [] }).outcomes.push(
        value,
      );
    else if (row.namespace === "verification-refresh")
      ((s.validationArchive ??= { predictions: [], outcomes: [] }).refreshed ??=
        {})[row.key] = value;
  }
  s.pivots = pivots.sort((a, b) => a.position - b.position).map((p) => p.pivot);
  for (const row of rows.filter((r) => r.namespace === "climate-feature"))
    if (s.climate?.[row.key]) s.climate[row.key].features = unpack(row);
  return s;
}
