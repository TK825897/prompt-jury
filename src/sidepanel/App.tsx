import { useCallback, useEffect, useState } from "react";
import type {
  NormalizedResponse,
  PageState,
  ProviderId,
} from "../adapters/types";
import {
  downloadText,
  exportFilename,
  serializeJson,
  serializeMarkdown,
} from "../export/serialize";
import { sendMessage } from "../messaging/client";
import { loadJudgeConfig } from "../judge/config";
import { JudgeEngine } from "../judge/core/judge-engine";
import { JudgeRunner } from "../judge/core/judge-runner";
import { runSynthesis } from "../judge/judge-client";
import type { AnonymousAnswer } from "../judge/prompts";
import { OpenAICompatibleJudgeProvider } from "../judge/providers/api/openai-compatible-provider";
import { ChatGPTWebJudgeProvider } from "../judge/providers/web/chatgpt-web-provider";
import { BrowserJudgeSessionManager } from "../judge/session/judge-session-manager";
import { useUiLanguage, type MessageKey } from "../i18n";
import {
  deleteRun,
  getRunBundle,
  listRuns,
  saveRunBundle,
} from "../storage/db";
import type {
  EvaluationBundle,
  EvaluationRun,
  ProviderRunResult,
  ResponseDocument,
} from "../storage/types";

const providerNames = {
  mock: "Mock",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  kimi: "Kimi",
  doubao: "Doubao",
} as const;

function statusKey(status: string): MessageKey | undefined {
  const keys: Record<string, MessageKey> = {
    not_open: "status_not_open",
    ready: "status_ready",
    error: "status_error",
    login_required: "status_login_required",
    sending: "status_sending",
    generating: "status_generating",
    completed: "status_completed",
    timeout: "status_timeout",
    failed: "status_failed",
    running: "status_running",
    partial: "status_partial",
  };
  return keys[status];
}

function isPageStates(data: unknown): data is PageState[] {
  return Array.isArray(data);
}
function isResponse(data: unknown): data is NormalizedResponse {
  return typeof data === "object" && data !== null && "contentText" in data;
}
function isProviderId(value: string): value is ProviderId {
  return value in providerNames;
}
function makeId(): string {
  return crypto.randomUUID();
}

function toDocument(
  response: NormalizedResponse,
  runId: string,
  startedAt: string,
  durationMs: number,
): ResponseDocument {
  return {
    id: makeId(),
    runId,
    providerId: response.providerId,
    modelName: response.modelName,
    text: response.contentText,
    markdown: response.contentMarkdown,
    codeBlocks: response.codeBlocks,
    tables: response.tables,
    metadata: {
      sourceUrl: response.sourceUrl,
      startedAt: response.startedAt ?? startedAt,
      completedAt: response.completedAt,
      durationMs,
    },
  };
}

export function App() {
  const { language, t, toggleLanguage } = useUiLanguage();
  const [pages, setPages] = useState<PageState[]>([]);
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [bundle, setBundle] = useState<EvaluationBundle>();
  const [history, setHistory] = useState<EvaluationRun[]>([]);
  const [providerProgress, setProviderProgress] = useState<
    Partial<Record<ProviderId, string>>
  >({});
  const [view, setView] = useState<"run" | "history">("run");
  const [busy, setBusy] = useState(false);
  const [judgeBusy, setJudgeBusy] = useState(false);
  const [judgeMessage, setJudgeMessage] = useState("");
  const [judgeProvider, setJudgeProvider] = useState<"api" | "chatgpt-web">(
    "api",
  );
  const [synthesisMode, setSynthesisMode] = useState<
    "best" | "repair" | "disagreements"
  >("best");
  const [error, setError] = useState("");

  const refreshHistory = useCallback(
    async () => setHistory(await listRuns()),
    [],
  );
  const detect = useCallback(async () => {
    setError("");
    try {
      const result = await sendMessage({ type: "DETECT_PROVIDERS" });
      if (!result.ok) throw new Error(result.error);
      if (isPageStates(result.data)) {
        const detectedPages = result.data;
        setPages(detectedPages);
        setSelected((current) =>
          current.filter((tabId) =>
            detectedPages.some((page) => page.tabId === tabId),
          ),
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("detectFailed"));
    }
  }, [t]);

  useEffect(() => {
    void detect();
    void refreshHistory();
  }, [detect, refreshHistory]);

  async function run(mock: boolean) {
    const targets = mock
      ? pages.filter((page) => page.tabId !== undefined).slice(0, 1)
      : pages.filter(
          (page) => page.tabId !== undefined && selected.includes(page.tabId),
        );
    if (!targets.length || !prompt.trim()) return;
    const runId = makeId();
    const createdAt = new Date().toISOString();
    const initialRun: EvaluationRun = {
      id: runId,
      prompt: prompt.trim(),
      selectedProviders: targets.map((page) =>
        mock ? "mock" : page.providerId,
      ),
      status: "running",
      providerResults: [],
      createdAt,
    };
    const initialBundle = {
      run: initialRun,
      responses: [],
    } satisfies EvaluationBundle;
    setBundle(initialBundle);
    setBusy(true);
    setError("");
    setProviderProgress(
      Object.fromEntries(
        targets.map((page) => [mock ? "mock" : page.providerId, "sending"]),
      ),
    );
    try {
      await saveRunBundle(initialBundle);
    } catch (reason) {
      setBusy(false);
      setError(
        `${t("createRunFailed")}: ${reason instanceof Error ? reason.message : t("dbWriteFailed")}`,
      );
      return;
    }

    const tasks = targets.map(
      async (
        page,
      ): Promise<{
        response?: ResponseDocument;
        result: ProviderRunResult;
      }> => {
        const providerId = mock ? "mock" : page.providerId;
        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        setProviderProgress((current) => ({
          ...current,
          [providerId]: "generating",
        }));
        try {
          if (!page.tabId) throw new Error("missing tab id");
          const result = await sendMessage({
            type: mock ? "MOCK_ROUNDTRIP" : "SEND_PROMPT",
            tabId: page.tabId,
            prompt,
          });
          if (!result.ok) throw new Error(result.error);
          if (!isResponse(result.data)) throw new Error(t("invalidResponse"));
          const durationMs = Date.now() - startedMs;
          const response = toDocument(
            result.data,
            runId,
            startedAt,
            durationMs,
          );
          setBundle((current) =>
            current
              ? { ...current, responses: [...current.responses, response] }
              : current,
          );
          setProviderProgress((current) => ({
            ...current,
            [providerId]: "completed",
          }));
          return {
            response,
            result: { providerId, status: "completed", durationMs },
          };
        } catch (reason) {
          const message =
            reason instanceof Error ? reason.message : t("unknownError");
          const status = /timed out|timeout/i.test(message)
            ? "timeout"
            : "failed";
          setProviderProgress((current) => ({
            ...current,
            [providerId]: status,
          }));
          return {
            result: {
              providerId,
              status,
              durationMs: Date.now() - startedMs,
              errorMessage: message,
            },
          };
        }
      },
    );

    const results = await Promise.all(tasks);
    const responses = results.flatMap((item) =>
      item.response ? [item.response] : [],
    );
    const providerResults = results.map((item) => item.result);
    const completedCount = providerResults.filter(
      (item) => item.status === "completed",
    ).length;
    const finalRun: EvaluationRun = {
      ...initialRun,
      providerResults,
      completedAt: new Date().toISOString(),
      status:
        completedCount === providerResults.length
          ? "completed"
          : completedCount > 0
            ? "partial"
            : "failed",
    };
    const finalBundle = { run: finalRun, responses };
    setBundle(finalBundle);
    setBusy(false);
    const failures = providerResults.filter(
      (item) => item.status !== "completed",
    );
    if (failures.length)
      setError(
        failures
          .map(
            (item) => `${providerNames[item.providerId]}: ${item.errorMessage}`,
          )
          .join("；"),
      );
    try {
      await saveRunBundle(finalBundle);
      await refreshHistory();
    } catch (reason) {
      setError(
        (current) =>
          `${current ? `${current}; ` : ""}${t("localSaveFailed")}: ${reason instanceof Error ? reason.message : t("dbWriteFailed")}`,
      );
    }
  }

  async function openHistory(runId: string) {
    const saved = await getRunBundle(runId);
    if (saved) {
      setBundle(saved);
      setPrompt(saved.run.prompt);
      setView("run");
    }
  }

  async function removeHistory(runId: string) {
    await deleteRun(runId);
    if (bundle?.run.id === runId) setBundle(undefined);
    await refreshHistory();
  }

  function selectJudgeResult(judgeResultId: string) {
    const judgeResult = bundle?.judgeRuns?.find(
      (candidate) => candidate.id === judgeResultId,
    );
    if (bundle && judgeResult) setBundle({ ...bundle, judgeResult });
  }

  function exportBundle(format: "md" | "json") {
    if (!bundle) return;
    const content =
      format === "md" ? serializeMarkdown(bundle) : serializeJson(bundle);
    downloadText(
      content,
      exportFilename(format),
      format === "md"
        ? "text/markdown;charset=utf-8"
        : "application/json;charset=utf-8",
    );
  }

  async function judgeCurrentRun() {
    if (!bundle || bundle.responses.length < 2) return;
    setJudgeBusy(true);
    setError("");
    setJudgeMessage(t("readingJudge"));
    try {
      const config = await loadJudgeConfig();
      const provider =
        judgeProvider === "api"
          ? new OpenAICompatibleJudgeProvider(config)
          : new ChatGPTWebJudgeProvider(new BrowserJudgeSessionManager());
      if (judgeProvider === "api") {
        if (!config.apiKey || !config.model)
          throw new Error(t("configureJudge"));
        setJudgeMessage(t("callingJudge", { model: config.model }));
      } else {
        setJudgeMessage(t("callingWebJudge"));
      }
      const judged = await new JudgeRunner(new JudgeEngine([provider])).run(
        provider.id,
        {
          runId: bundle.run.id,
          originalPrompt: bundle.run.prompt,
          responses: bundle.responses.map((response) => ({
            id: response.id,
            provider: response.providerId,
            model: response.modelName,
            content: response.text,
          })),
          evaluationCriteria: config.weights,
          mode: "evaluate",
        },
      );
      setJudgeMessage(t("savingJudge"));
      const anonymousMapping = Object.fromEntries(
        Object.entries(judged.anonymousMapping).flatMap(
          ([answerId, candidate]) =>
            isProviderId(candidate.provider)
              ? [[answerId, candidate.provider]]
              : [],
        ),
      );
      const judgeResult = {
        id: makeId(),
        runId: bundle.run.id,
        model: judgeProvider === "api" ? config.model : provider.name,
        provider: judged.providerId,
        type:
          judged.providerType === "web" ? ("web" as const) : ("api" as const),
        anonymousMapping,
        rawJson: JSON.stringify(judged.result),
        result: judged.result,
        createdAt: judged.completedAt,
      };
      const next: EvaluationBundle = {
        ...bundle,
        judgeResult,
        judgeRuns: [...(bundle.judgeRuns ?? []), judgeResult],
      };
      setBundle(next);
      await saveRunBundle(next);
      setJudgeMessage(t("judgeSaved"));
    } catch (reason) {
      const code =
        reason && typeof reason === "object" && "code" in reason
          ? String(reason.code)
          : "";
      const detail =
        reason instanceof Error && reason.cause instanceof Error
          ? reason.cause.message
          : "";
      const message =
        code === "PROVIDER_UNAVAILABLE"
          ? judgeProvider === "chatgpt-web"
            ? t("webJudgeUnavailable")
            : t("configureJudge")
          : code === "SESSION_CREATE_FAILED"
            ? `${t("sessionCreateFailed")}${detail ? ` ${detail}` : ""}`
            : code === "SESSION_CLEANUP_FAILED"
              ? t("sessionCleanupFailed")
              : code === "WEB_RESPONSE_INVALID"
                ? `${t("webResponseInvalid")}${reason instanceof Error ? ` ${reason.message}` : ""}`
                : reason instanceof Error
                  ? reason.message
                  : t("judgeFailed");
      setError(message);
      setJudgeMessage(`${t("judgeFailed")}: ${message}`);
    } finally {
      setJudgeBusy(false);
    }
  }

  function anonymousAnswersFromBundle(
    current: EvaluationBundle,
  ): AnonymousAnswer[] {
    if (!current.judgeResult) return [];
    return Object.entries(current.judgeResult.anonymousMapping).flatMap(
      ([answerId, providerId]) => {
        const response = current.responses.find(
          (item) => item.providerId === providerId,
        );
        return response ? [{ answerId, text: response.text }] : [];
      },
    );
  }

  async function synthesizeCurrentRun() {
    if (!bundle?.judgeResult) return;
    setJudgeBusy(true);
    setError("");
    setJudgeMessage(t("generatingSynthesis"));
    try {
      const config = await loadJudgeConfig();
      if (!config.apiKey || !config.model)
        throw new Error(t("configureJudgeApi"));
      const content = await runSynthesis(
        config,
        synthesisMode,
        bundle.run.prompt,
        anonymousAnswersFromBundle(bundle),
        bundle.judgeResult.result,
      );
      const answer = {
        id: makeId(),
        runId: bundle.run.id,
        mode: synthesisMode,
        content,
        createdAt: new Date().toISOString(),
      } as const;
      const next: EvaluationBundle = {
        ...bundle,
        synthesizedAnswers: [...(bundle.synthesizedAnswers ?? []), answer],
      };
      setBundle(next);
      await saveRunBundle(next);
      setJudgeMessage(t("synthesisSaved"));
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : t("synthesisFailed");
      setError(message);
      setJudgeMessage(`${t("synthesisFailed")}: ${message}`);
    } finally {
      setJudgeBusy(false);
    }
  }

  const available = pages.some((page) => page.tabId !== undefined);
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const labelStatus = (status: string) => {
    const key = statusKey(status);
    return key ? t(key) : status;
  };
  const modeName = (mode: "best" | "repair" | "disagreements") =>
    t(mode === "disagreements" ? "preserve" : mode);
  return (
    <main>
      <header>
        <div className="header-tools">
          <p className="eyebrow">
            Judge Engine · v{chrome.runtime.getManifest().version}
          </p>
          <button className="quiet language-toggle" onClick={toggleLanguage}>
            {t("languageName")}
          </button>
        </div>
        <h1>Prompt Jury</h1>
        <p>
          Compare multiple LLM responses, judge the differences, and synthesize
          the best answer.
        </p>
      </header>
      <nav>
        <button
          className={view === "run" ? "" : "quiet"}
          onClick={() => setView("run")}
        >
          {t("run")}
        </button>
        <button
          className={view === "history" ? "" : "quiet"}
          onClick={() => setView("history")}
        >
          {t("history")} ({history.length})
        </button>
      </nav>
      {view === "history" ? (
        <section>
          <div className="section-title">
            <h2>{t("historyRuns")}</h2>
            <button className="quiet" onClick={() => void refreshHistory()}>
              {t("refresh")}
            </button>
          </div>
          {history.length === 0 ? (
            <p className="muted">{t("noHistory")}</p>
          ) : (
            history.map((run) => (
              <article className="history-item" key={run.id}>
                <button
                  className="history-open"
                  onClick={() => void openHistory(run.id)}
                >
                  <strong>{run.prompt.slice(0, 60)}</strong>
                  <span>
                    {new Date(run.createdAt).toLocaleString(locale)} ·{" "}
                    {labelStatus(run.status)}
                  </span>
                </button>
                <button
                  className="danger"
                  onClick={() => void removeHistory(run.id)}
                >
                  {t("delete")}
                </button>
              </article>
            ))
          )}
        </section>
      ) : (
        <>
          <section>
            <div className="section-title">
              <h2>Provider</h2>
              <button className="quiet" onClick={() => void detect()}>
                {t("detectAgain")}
              </button>
            </div>
            {pages.length === 0 ? (
              <p className="muted">{t("detecting")}</p>
            ) : (
              pages.map((page) => (
                <div key={page.providerId}>
                  <label className="provider">
                    <input
                      type="checkbox"
                      disabled={
                        page.tabId === undefined ||
                        page.status === "error" ||
                        page.status === "login_required"
                      }
                      checked={
                        page.tabId !== undefined &&
                        selected.includes(page.tabId)
                      }
                      onChange={() =>
                        page.tabId !== undefined &&
                        setSelected((current) =>
                          current.includes(page.tabId!)
                            ? current.filter((id) => id !== page.tabId)
                            : [...current, page.tabId!],
                        )
                      }
                    />
                    <span
                      className={`dot ${providerProgress[page.providerId] ?? page.status}`}
                    />
                    <strong>{providerNames[page.providerId]}</strong>
                    <span>
                      {labelStatus(
                        providerProgress[page.providerId] ?? page.status,
                      )}
                    </span>
                  </label>
                  {page.errorMessage && (
                    <p className="provider-error">{page.errorMessage}</p>
                  )}
                </div>
              ))
            )}
          </section>
          <section>
            <div className="section-title">
              <label htmlFor="prompt">
                <h2>Prompt</h2>
              </label>
              <span className="counter">
                {prompt.length} {t("characters")}
              </span>
            </div>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("promptPlaceholder")}
              rows={7}
            />
            <div className="actions">
              <button
                className="quiet"
                disabled={!prompt || busy}
                onClick={() => setPrompt("")}
              >
                {t("clear")}
              </button>
              <button
                className="quiet"
                disabled={!available || !prompt.trim() || busy}
                onClick={() => void run(true)}
              >
                Mock
              </button>
              <button
                disabled={!selected.length || !prompt.trim() || busy}
                onClick={() => void run(false)}
              >
                {busy
                  ? t("waitingResponses")
                  : `${t("sendSelected")} (${selected.length})`}
              </button>
            </div>
          </section>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {bundle && (
            <section>
              <div className="section-title">
                <div>
                  <p className="eyebrow">Evaluation Run</p>
                  <h2>
                    {labelStatus(bundle.run.status)} · {bundle.responses.length}
                    /{bundle.run.selectedProviders.length}
                  </h2>
                </div>
                <div className="actions">
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => exportBundle("md")}
                  >
                    Markdown
                  </button>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => exportBundle("json")}
                  >
                    JSON
                  </button>
                </div>
              </div>
              <p className="muted">
                {new Date(bundle.run.createdAt).toLocaleString(locale)}
              </p>
            </section>
          )}
          {bundle?.responses.map((response) => (
            <section key={response.id}>
              <div className="section-title">
                <div>
                  <p className="eyebrow">
                    {providerNames[response.providerId]}
                  </p>
                  <h2>{response.modelName ?? t("latestResponse")}</h2>
                </div>
                <span className="counter">
                  {response.metadata.durationMs
                    ? `${(response.metadata.durationMs / 1000).toFixed(1)}s`
                    : ""}
                </span>
              </div>
              <pre className="answer">{response.text}</pre>
              <div className="actions">
                <button
                  className="quiet"
                  onClick={() =>
                    void navigator.clipboard.writeText(response.text)
                  }
                >
                  {t("copy")}
                </button>
                {response.metadata.sourceUrl && (
                  <button
                    className="quiet"
                    onClick={() =>
                      void chrome.tabs.create({
                        url: response.metadata.sourceUrl,
                      })
                    }
                  >
                    {t("openSource")}
                  </button>
                )}
              </div>
            </section>
          ))}
          <section>
            <div className="section-title">
              <div>
                <p className="eyebrow">AI Judge</p>
                <h2>{t("anonymousReview")}</h2>
              </div>
              <button
                className="quiet"
                onClick={() => void chrome.runtime.openOptionsPage()}
              >
                {t("settings")}
              </button>
            </div>
            <div className="judge-provider-options">
              <h2>{t("selectJudge")}</h2>
              <label
                className={
                  judgeProvider === "api"
                    ? "judge-provider-option selected"
                    : "judge-provider-option"
                }
              >
                <input
                  type="radio"
                  name="judge-provider"
                  value="api"
                  checked={judgeProvider === "api"}
                  disabled={judgeBusy}
                  onChange={() => setJudgeProvider("api")}
                />
                <span>
                  <strong>{t("apiJudge")}</strong>
                  <small>{t("apiJudgeHelp")}</small>
                </span>
              </label>
              <label
                className={
                  judgeProvider === "chatgpt-web"
                    ? "judge-provider-option selected"
                    : "judge-provider-option"
                }
              >
                <input
                  type="radio"
                  name="judge-provider"
                  value="chatgpt-web"
                  checked={judgeProvider === "chatgpt-web"}
                  disabled={judgeBusy}
                  onChange={() => setJudgeProvider("chatgpt-web")}
                />
                <span>
                  <strong>{t("chatgptWebJudge")}</strong>
                  <small>{t("webJudgeHelp")}</small>
                </span>
              </label>
            </div>
            {Boolean(bundle?.judgeRuns?.length) && (
              <>
                <p className="muted">
                  {t("judgeRunCount", {
                    count: bundle?.judgeRuns?.length ?? 0,
                  })}
                </p>
                {(bundle?.judgeRuns?.length ?? 0) > 1 && (
                  <label className="judge-result-select">
                    {t("viewJudgeResult")}
                    <select
                      value={bundle?.judgeResult?.id}
                      onChange={(event) =>
                        selectJudgeResult(event.target.value)
                      }
                    >
                      {bundle?.judgeRuns?.map((run) => (
                        <option key={run.id} value={run.id}>
                          {run.model} ·{" "}
                          {new Date(run.createdAt).toLocaleString(locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {judgeMessage && (
              <p
                className={
                  judgeMessage.startsWith(t("judgeFailed")) ||
                  judgeMessage.startsWith(t("synthesisFailed"))
                    ? "error"
                    : "judge-message"
                }
                role="status"
              >
                {judgeMessage}
              </p>
            )}
            {!bundle ? (
              <>
                <p className="muted">{t("needRun")}</p>
                <button disabled>{t("runJudge")}</button>
              </>
            ) : busy ? (
              <>
                <p className="muted">{t("waitingModels")}</p>
                <button disabled>{t("runJudge")}</button>
              </>
            ) : !bundle.judgeResult ? (
              <>
                <p className="muted">
                  {t("collected", { count: bundle.responses.length })}
                </p>
                <button
                  disabled={bundle.responses.length < 2 || judgeBusy}
                  onClick={() => void judgeCurrentRun()}
                >
                  {judgeBusy ? t("judging") : t("runJudge")}
                </button>
              </>
            ) : (
              <>
                <p className="muted">
                  <strong>{t("currentJudge")}:</strong>{" "}
                  {bundle.judgeResult.model}
                </p>
                <p>{bundle.judgeResult.result.summary}</p>
                {[...bundle.judgeResult.result.ranking]
                  .sort((a, b) => a.rank - b.rank)
                  .map((rank) => (
                    <article className="history-item" key={rank.answerId}>
                      <div className="history-open">
                        <strong>
                          #{rank.rank}{" "}
                          {
                            providerNames[
                              bundle.judgeResult!.anonymousMapping[
                                rank.answerId
                              ]
                            ]
                          }
                        </strong>
                        <span>
                          {t("judgeScore")} {rank.overallScore.toFixed(1)} ·{" "}
                          {t("confidence")} {rank.confidence.toFixed(0)}
                        </span>
                      </div>
                    </article>
                  ))}
                {bundle.judgeResult.result.evaluations.map((evaluation) => (
                  <details key={evaluation.answerId}>
                    <summary>
                      {
                        providerNames[
                          bundle.judgeResult!.anonymousMapping[
                            evaluation.answerId
                          ]
                        ]
                      }{" "}
                      {t("scoreDetails")}
                    </summary>
                    <div className="score-grid">
                      {Object.entries(evaluation.scores).map(([key, value]) => (
                        <div className="score" key={key}>
                          <strong>{value}</strong>
                          <span>{t(key as MessageKey)}</span>
                        </div>
                      ))}
                    </div>
                    <p>
                      <strong>{t("strengths")}:</strong>{" "}
                      {evaluation.strengths.join(
                        language === "zh" ? "；" : "; ",
                      ) || t("none")}
                    </p>
                    <p>
                      <strong>{t("weaknesses")}:</strong>{" "}
                      {evaluation.weaknesses.join(
                        language === "zh" ? "；" : "; ",
                      ) || t("none")}
                    </p>
                    <p>
                      <strong>{t("risks")}:</strong>{" "}
                      {evaluation.riskFlags
                        .map(
                          (risk) =>
                            `[${risk.severity}] ${risk.type}: ${risk.description}`,
                        )
                        .join(language === "zh" ? "；" : "; ") || t("none")}
                    </p>
                    <p>
                      <strong>{t("unsupported")}:</strong>{" "}
                      {evaluation.unsupportedClaims.join(
                        language === "zh" ? "；" : "; ",
                      ) || t("none")}
                    </p>
                  </details>
                ))}
                <div>
                  <h2>{t("consensus")}</h2>
                  <ul>
                    {bundle.judgeResult.result.consensus.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2>{t("disagreements")}</h2>
                  <ul>
                    {bundle.judgeResult.result.disagreements.map((item) => (
                      <li key={item.topic}>
                        {item.topic}: {item.judgeAssessment}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  className="quiet"
                  disabled={judgeBusy}
                  onClick={() => void judgeCurrentRun()}
                >
                  {t("rerunJudge")}
                </button>
              </>
            )}
          </section>
          {bundle?.judgeResult && (
            <section>
              <p className="eyebrow">Synthesis</p>
              <h2>{t("synthesis")}</h2>
              <select
                value={synthesisMode}
                onChange={(event) =>
                  setSynthesisMode(event.target.value as typeof synthesisMode)
                }
              >
                <option value="best">{t("best")}</option>
                <option value="repair">{t("repair")}</option>
                <option value="disagreements">{t("preserve")}</option>
              </select>
              <button
                disabled={judgeBusy}
                onClick={() => void synthesizeCurrentRun()}
              >
                {judgeBusy ? t("generating") : t("generateSynthesis")}
              </button>
              {bundle.synthesizedAnswers?.map((answer) => (
                <article className="synthesis-answer" key={answer.id}>
                  <div className="section-title">
                    <strong>{modeName(answer.mode)}</strong>
                    <span className="counter">
                      {new Date(answer.createdAt).toLocaleString(locale)}
                    </span>
                  </div>
                  <pre className="answer">{answer.content}</pre>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
