import { openDB, type DBSchema } from "idb";
import type {
  EvaluationBundle,
  EvaluationRun,
  ResponseDocument,
  StoredJudgeResult,
  SynthesizedAnswer,
} from "./types";

interface LegacyRun {
  id: string;
  prompt: string;
  createdAt: string;
  responses: unknown[];
}

interface LabDatabase extends DBSchema {
  runs: { key: string; value: LegacyRun; indexes: { "by-created-at": string } };
  evaluationRuns: {
    key: string;
    value: EvaluationRun;
    indexes: { "by-created-at": string };
  };
  responses: {
    key: string;
    value: ResponseDocument;
    indexes: { "by-run-id": string };
  };
  judgeResults: {
    key: string;
    value: StoredJudgeResult;
    indexes: { "by-run-id": string };
  };
  judgeRuns: {
    key: string;
    value: StoredJudgeResult;
    indexes: { "by-run-id": string };
  };
  synthesizedAnswers: {
    key: string;
    value: SynthesizedAnswer;
    indexes: { "by-run-id": string };
  };
}

const database = openDB<LabDatabase>("multi-llm-response-lab", 5, {
  upgrade(db, oldVersion, _newVersion, transaction) {
    if (!db.objectStoreNames.contains("runs")) {
      const legacy = db.createObjectStore("runs", { keyPath: "id" });
      legacy.createIndex("by-created-at", "createdAt");
    }
    if (!db.objectStoreNames.contains("evaluationRuns")) {
      const runs = db.createObjectStore("evaluationRuns", { keyPath: "id" });
      runs.createIndex("by-created-at", "createdAt");
    }
    if (!db.objectStoreNames.contains("responses")) {
      const responses = db.createObjectStore("responses", { keyPath: "id" });
      responses.createIndex("by-run-id", "runId");
    }
    if (!db.objectStoreNames.contains("judgeResults")) {
      const store = db.createObjectStore("judgeResults", { keyPath: "id" });
      store.createIndex("by-run-id", "runId", { unique: true });
    }
    if (!db.objectStoreNames.contains("judgeRuns")) {
      const store = db.createObjectStore("judgeRuns", { keyPath: "id" });
      store.createIndex("by-run-id", "runId");
    }
    if (!db.objectStoreNames.contains("synthesizedAnswers")) {
      const store = db.createObjectStore("synthesizedAnswers", {
        keyPath: "id",
      });
      store.createIndex("by-run-id", "runId");
    } else if (oldVersion < 4) {
      const store = transaction.objectStore("synthesizedAnswers");
      if (store.indexNames.contains("by-run-id"))
        store.deleteIndex("by-run-id");
      store.createIndex("by-run-id", "runId");
    }
  },
});

export async function saveRunBundle(bundle: EvaluationBundle): Promise<void> {
  const db = await database;
  const transaction = db.transaction(
    [
      "evaluationRuns",
      "responses",
      "judgeResults",
      "judgeRuns",
      "synthesizedAnswers",
    ],
    "readwrite",
  );
  await transaction.objectStore("evaluationRuns").put(bundle.run);
  const responseStore = transaction.objectStore("responses");
  const existing = await responseStore
    .index("by-run-id")
    .getAllKeys(bundle.run.id);
  await Promise.all(existing.map((key) => responseStore.delete(key)));
  await Promise.all(
    bundle.responses.map((response) => responseStore.put(response)),
  );
  const judgeStore = transaction.objectStore("judgeResults");
  const oldJudge = await judgeStore.index("by-run-id").getKey(bundle.run.id);
  if (oldJudge) await judgeStore.delete(oldJudge);
  if (bundle.judgeResult) await judgeStore.put(bundle.judgeResult);
  const judgeRunStore = transaction.objectStore("judgeRuns");
  const oldJudgeRuns = await judgeRunStore
    .index("by-run-id")
    .getAllKeys(bundle.run.id);
  await Promise.all(oldJudgeRuns.map((key) => judgeRunStore.delete(key)));
  const judgeRuns =
    bundle.judgeRuns ?? (bundle.judgeResult ? [bundle.judgeResult] : []);
  await Promise.all(judgeRuns.map((judgeRun) => judgeRunStore.put(judgeRun)));
  const synthesisStore = transaction.objectStore("synthesizedAnswers");
  const oldSyntheses = await synthesisStore
    .index("by-run-id")
    .getAllKeys(bundle.run.id);
  await Promise.all(oldSyntheses.map((key) => synthesisStore.delete(key)));
  await Promise.all(
    (bundle.synthesizedAnswers ?? []).map((answer) =>
      synthesisStore.put(answer),
    ),
  );
  await transaction.done;
}

export async function listRuns(): Promise<EvaluationRun[]> {
  const db = await database;
  return (
    await db.getAllFromIndex("evaluationRuns", "by-created-at")
  ).reverse();
}

export async function getRunBundle(
  runId: string,
): Promise<EvaluationBundle | undefined> {
  const db = await database;
  const [run, responses, legacyJudgeResult, judgeRuns, synthesizedAnswers] =
    await Promise.all([
      db.get("evaluationRuns", runId),
      db.getAllFromIndex("responses", "by-run-id", runId),
      db.getFromIndex("judgeResults", "by-run-id", runId),
      db.getAllFromIndex("judgeRuns", "by-run-id", runId),
      db.getAllFromIndex("synthesizedAnswers", "by-run-id", runId),
    ]);
  if (!run) return undefined;
  const sortedJudgeRuns = [...judgeRuns].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const compatibleJudgeRuns = sortedJudgeRuns.length
    ? sortedJudgeRuns
    : legacyJudgeResult
      ? [legacyJudgeResult]
      : [];
  return {
    run,
    responses,
    judgeResult: compatibleJudgeRuns.at(-1),
    judgeRuns: compatibleJudgeRuns,
    synthesizedAnswers,
  };
}

export async function deleteRun(runId: string): Promise<void> {
  const db = await database;
  const transaction = db.transaction(
    [
      "evaluationRuns",
      "responses",
      "judgeResults",
      "judgeRuns",
      "synthesizedAnswers",
    ],
    "readwrite",
  );
  await transaction.objectStore("evaluationRuns").delete(runId);
  const responseStore = transaction.objectStore("responses");
  const keys = await responseStore.index("by-run-id").getAllKeys(runId);
  await Promise.all(keys.map((key) => responseStore.delete(key)));
  for (const storeName of [
    "judgeResults",
    "judgeRuns",
    "synthesizedAnswers",
  ] as const) {
    const store = transaction.objectStore(storeName);
    const keys = await store.index("by-run-id").getAllKeys(runId);
    await Promise.all(keys.map((key) => store.delete(key)));
  }
  await transaction.done;
}
