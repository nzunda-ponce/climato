import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { defaultRules, Pivot, Rules, WeatherForecast } from "@/domain/types";
import {
  EnsembleAssessment,
  HistoricalClimate,
  Observation,
} from "@/domain/evidence";
import { gzipSync, gunzipSync } from "node:zlib";
import { replaceFile } from "./replace-file";
import type { SeasonalAssessment } from "@/domain/seasonal";
import {
  freezePredictions,
  ValidationArchive,
} from "@/domain/forecast-validation";
export interface State {
  validationArchive?: ValidationArchive;
  pivots: Pivot[];
  rules: Rules;
  forecasts: Record<string, WeatherForecast>;
  ensembles?: Record<string, EnsembleAssessment>;
  ensembleFailures?: Record<string, { at: string; message: string }>;
  climate?: Record<string, HistoricalClimate>;
  observations?: Observation[];
  seasonal?: Record<string, SeasonalAssessment>;
}
const globalDb = globalThis as unknown as { climatoDb?: PrismaClient };
const db = process.env.DATABASE_URL
  ? (globalDb.climatoDb ??= new PrismaClient())
  : null;
const dir = path.join(process.cwd(), "data");
const statePath = path.join(dir, "state.json");
export async function readState(): Promise<State> {
  if (db) {
    const rows = await db.appState.findUnique({ where: { id: "campaign" } });
    return rows
      ? {
          ...(rows.payload as unknown as State),
          rules: {
            ...defaultRules,
            ...(rows.payload as unknown as State).rules,
          },
        }
      : { pivots: [], rules: defaultRules, forecasts: {} };
  }
  try {
    const s = JSON.parse(await fs.readFile(statePath, "utf8")) as State;
    return { ...s, rules: { ...defaultRules, ...s.rules } };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return { pivots: [], rules: defaultRules, forecasts: {} };
  }
}
export async function saveResearchRaw(
  key: string,
  kind: "ensemble" | "history",
  value: unknown,
) {
  await fs.mkdir(path.join(dir, "research"), { recursive: true });
  await fs.writeFile(
    path.join(
      dir,
      "research",
      `${kind}-${key.replace(/[^\d,.-]/g, "")}.json.gz`,
    ),
    gzipSync(JSON.stringify(value)),
  );
}
export async function readResearchRaw<T>(
  key: string,
  kind: "ensemble" | "history",
): Promise<T | undefined> {
  try {
    return JSON.parse(
      gunzipSync(
        await fs.readFile(
          path.join(
            dir,
            "research",
            `${kind}-${key.replace(/[^\d,.-]/g, "")}.json.gz`,
          ),
        ),
      ).toString(),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
let queue = Promise.resolve();
export async function mutateState(
  fn: (state: State) => void | Promise<void>,
): Promise<void> {
  const task = queue.then(async () => {
    await fs.mkdir(dir, { recursive: true });
    const lockPath = path.join(dir, "state.lock");
    let lock: Awaited<ReturnType<typeof fs.open>> | undefined;
    for (let attempt = 0; attempt < 300 && !lock; attempt++) {
      try {
        lock = await fs.open(lockPath, "wx");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!lock)
      throw new Error(
        "El almacenamiento está ocupado. Reintentá en unos segundos.",
      );
    try {
      const state = await readState();
      await fn(state);
      freezePredictions(
        (state.validationArchive ??= { predictions: [], outcomes: [] }),
        state.ensembles ?? {},
        state.rules,
      );
      if (db) {
        await db.appState.upsert({
          where: { id: "campaign" },
          create: {
            id: "campaign",
            payload: JSON.parse(JSON.stringify(state)),
          },
          update: { payload: JSON.parse(JSON.stringify(state)) },
        });
      } else {
        await fs.mkdir(dir, { recursive: true });
        const temp = statePath + `.${process.pid}.tmp`;
        await fs.writeFile(temp, JSON.stringify(state, null, 2));
        await replaceFile(temp, statePath);
      }
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  });
  queue = task.catch(() => {});
  return task;
}
export async function saveSnapshot(pivotId: string, forecast: WeatherForecast) {
  if (!forecast.models.length) return;
  if (db) {
    await db.forecastSnapshot.create({
      data: {
        pivotRef: pivotId,
        fetchedAt: new Date(forecast.fetchedAt),
        payload: JSON.parse(JSON.stringify(forecast)),
      },
    });
    return;
  }
  await fs.mkdir(path.join(dir, "snapshots"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "snapshots", `${pivotId}-${Date.now()}.json`),
    JSON.stringify(forecast),
  );
}
