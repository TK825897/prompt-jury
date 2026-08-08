import { useCallback, useEffect, useState } from "react";
import type { NormalizedResponse, PageState, ProviderId } from "../adapters/types";
import { downloadText, exportFilename, serializeJson, serializeMarkdown } from "../export/serialize";
import { sendMessage } from "../messaging/client";
import { anonymizeResponses } from "../judge/anonymize";
import { loadJudgeConfig } from "../judge/config";
import { runJudge, runSynthesis } from "../judge/judge-client";
import type { AnonymousAnswer } from "../judge/prompts";
import { deleteRun, getRunBundle, listRuns, saveRunBundle } from "../storage/db";
import type { EvaluationBundle, EvaluationRun, ProviderRunResult, ResponseDocument } from "../storage/types";

const providerNames = { mock: "Mock", chatgpt: "ChatGPT", gemini: "Gemini", kimi: "Kimi", doubao: "豆包" } as const;

function isPageStates(data: unknown): data is PageState[] { return Array.isArray(data); }
function isResponse(data: unknown): data is NormalizedResponse { return typeof data === "object" && data !== null && "contentText" in data; }
function makeId(): string { return crypto.randomUUID(); }

function toDocument(response: NormalizedResponse, runId: string, startedAt: string, durationMs: number): ResponseDocument {
  return {
    id: makeId(), runId, providerId: response.providerId, modelName: response.modelName,
    text: response.contentText, markdown: response.contentMarkdown,
    codeBlocks: response.codeBlocks, tables: response.tables,
    metadata: { sourceUrl: response.sourceUrl, startedAt: response.startedAt ?? startedAt, completedAt: response.completedAt, durationMs },
  };
}

export function App() {
  const [pages, setPages] = useState<PageState[]>([]);
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [bundle, setBundle] = useState<EvaluationBundle>();
  const [history, setHistory] = useState<EvaluationRun[]>([]);
  const [providerProgress, setProviderProgress] = useState<Partial<Record<ProviderId, string>>>({});
  const [view, setView] = useState<"run" | "history">("run");
  const [busy, setBusy] = useState(false);
  const [judgeBusy, setJudgeBusy] = useState(false);
  const [judgeMessage, setJudgeMessage] = useState("");
  const [synthesisMode, setSynthesisMode] = useState<"best" | "repair" | "disagreements">("best");
  const [error, setError] = useState("");

  const refreshHistory = useCallback(async () => setHistory(await listRuns()), []);
  const detect = useCallback(async () => {
    setError("");
    try {
      const result = await sendMessage({ type: "DETECT_PROVIDERS" });
      if (!result.ok) throw new Error(result.error);
      if (isPageStates(result.data)) {
        const detectedPages = result.data;
        setPages(detectedPages);
        setSelected((current) => current.filter((tabId) => detectedPages.some((page) => page.tabId === tabId)));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "检测失败"); }
  }, []);

  useEffect(() => { void detect(); void refreshHistory(); }, [detect, refreshHistory]);

  async function run(mock: boolean) {
    const targets = mock ? pages.filter((page) => page.tabId !== undefined).slice(0, 1) : pages.filter((page) => page.tabId !== undefined && selected.includes(page.tabId));
    if (!targets.length || !prompt.trim()) return;
    const runId = makeId();
    const createdAt = new Date().toISOString();
    const initialRun: EvaluationRun = {
      id: runId, prompt: prompt.trim(), selectedProviders: targets.map((page) => mock ? "mock" : page.providerId),
      status: "running", providerResults: [], createdAt,
    };
    const initialBundle = { run: initialRun, responses: [] } satisfies EvaluationBundle;
    setBundle(initialBundle); setBusy(true); setError("");
    setProviderProgress(Object.fromEntries(targets.map((page) => [mock ? "mock" : page.providerId, "sending"])));
    try {
      await saveRunBundle(initialBundle);
    } catch (reason) {
      setBusy(false);
      setError(`无法创建本地运行记录：${reason instanceof Error ? reason.message : "IndexedDB 写入失败"}`);
      return;
    }

    const tasks = targets.map(async (page): Promise<{ response?: ResponseDocument; result: ProviderRunResult }> => {
      const providerId = mock ? "mock" : page.providerId;
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      setProviderProgress((current) => ({ ...current, [providerId]: "generating" }));
      try {
        if (!page.tabId) throw new Error("missing tab id");
        const result = await sendMessage({ type: mock ? "MOCK_ROUNDTRIP" : "SEND_PROMPT", tabId: page.tabId, prompt });
        if (!result.ok) throw new Error(result.error);
        if (!isResponse(result.data)) throw new Error("返回的数据类型不正确");
        const durationMs = Date.now() - startedMs;
        const response = toDocument(result.data, runId, startedAt, durationMs);
        setBundle((current) => current ? { ...current, responses: [...current.responses, response] } : current);
        setProviderProgress((current) => ({ ...current, [providerId]: "completed" }));
        return { response, result: { providerId, status: "completed", durationMs } };
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "未知错误";
        const status = /timed out|timeout/i.test(message) ? "timeout" : "failed";
        setProviderProgress((current) => ({ ...current, [providerId]: status }));
        return { result: { providerId, status, durationMs: Date.now() - startedMs, errorMessage: message } };
      }
    });

    const results = await Promise.all(tasks);
    const responses = results.flatMap((item) => item.response ? [item.response] : []);
    const providerResults = results.map((item) => item.result);
    const completedCount = providerResults.filter((item) => item.status === "completed").length;
    const finalRun: EvaluationRun = {
      ...initialRun, providerResults, completedAt: new Date().toISOString(),
      status: completedCount === providerResults.length ? "completed" : completedCount > 0 ? "partial" : "failed",
    };
    const finalBundle = { run: finalRun, responses };
    setBundle(finalBundle); setBusy(false);
    const failures = providerResults.filter((item) => item.status !== "completed");
    if (failures.length) setError(failures.map((item) => `${providerNames[item.providerId]}: ${item.errorMessage}`).join("；"));
    try {
      await saveRunBundle(finalBundle);
      await refreshHistory();
    } catch (reason) {
      setError((current) => `${current ? `${current}；` : ""}本地保存失败：${reason instanceof Error ? reason.message : "IndexedDB 写入失败"}`);
    }
  }

  async function openHistory(runId: string) {
    const saved = await getRunBundle(runId);
    if (saved) { setBundle(saved); setPrompt(saved.run.prompt); setView("run"); }
  }

  async function removeHistory(runId: string) {
    await deleteRun(runId);
    if (bundle?.run.id === runId) setBundle(undefined);
    await refreshHistory();
  }

  function exportBundle(format: "md" | "json") {
    if (!bundle) return;
    const content = format === "md" ? serializeMarkdown(bundle) : serializeJson(bundle);
    downloadText(content, exportFilename(format), format === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8");
  }

  async function judgeCurrentRun() {
    if (!bundle || bundle.responses.length < 2) return;
    setJudgeBusy(true); setError(""); setJudgeMessage("正在读取 Judge 配置…");
    try {
      const config = await loadJudgeConfig();
      if (!config.apiKey || !config.model) throw new Error("请先在 Judge 设置中配置 API Key 和 Model。");
      setJudgeMessage(`正在调用 ${config.model} 进行匿名评审…`);
      const anonymous = anonymizeResponses(bundle.responses);
      const judged = await runJudge(config, bundle.run.prompt, anonymous.answers);
      setJudgeMessage("评审完成，正在保存本地结果…");
      const next: EvaluationBundle = {
        ...bundle,
        judgeResult: {
          id: makeId(), runId: bundle.run.id, model: config.model, anonymousMapping: anonymous.mapping,
          rawJson: judged.raw, result: judged.result, createdAt: new Date().toISOString(),
        },
      };
      setBundle(next); await saveRunBundle(next); setJudgeMessage("Judge 已完成并保存。");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Judge 失败";
      setError(message); setJudgeMessage(`Judge 失败：${message}`);
    }
    finally { setJudgeBusy(false); }
  }

  function anonymousAnswersFromBundle(current: EvaluationBundle): AnonymousAnswer[] {
    if (!current.judgeResult) return [];
    return Object.entries(current.judgeResult.anonymousMapping).flatMap(([answerId, providerId]) => {
      const response = current.responses.find((item) => item.providerId === providerId);
      return response ? [{ answerId, text: response.text }] : [];
    });
  }

  async function synthesizeCurrentRun() {
    if (!bundle?.judgeResult) return;
    setJudgeBusy(true); setError(""); setJudgeMessage("正在生成综合答案…");
    try {
      const config = await loadJudgeConfig();
      if (!config.apiKey || !config.model) throw new Error("请先配置 Judge API。");
      const content = await runSynthesis(config, synthesisMode, bundle.run.prompt, anonymousAnswersFromBundle(bundle), bundle.judgeResult.result);
      const answer = { id: makeId(), runId: bundle.run.id, mode: synthesisMode, content, createdAt: new Date().toISOString() } as const;
      const next: EvaluationBundle = { ...bundle, synthesizedAnswers: [...(bundle.synthesizedAnswers ?? []), answer] };
      setBundle(next); await saveRunBundle(next); setJudgeMessage("综合答案已生成并保存。");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "综合答案生成失败";
      setError(message); setJudgeMessage(`综合答案失败：${message}`);
    }
    finally { setJudgeBusy(false); }
  }

  const available = pages.some((page) => page.tabId !== undefined);
  return <main>
    <header><p className="eyebrow">MVP · Step 1–6 · v{chrome.runtime.getManifest().version}</p><h1>Prompt Jury</h1><p>Compare multiple LLM responses, judge the differences, and synthesize the best answer.</p></header>
    <nav><button className={view === "run" ? "" : "quiet"} onClick={() => setView("run")}>运行</button><button className={view === "history" ? "" : "quiet"} onClick={() => setView("history")}>历史 ({history.length})</button></nav>
    {view === "history" ? <section><div className="section-title"><h2>历史运行</h2><button className="quiet" onClick={() => void refreshHistory()}>刷新</button></div>
      {history.length === 0 ? <p className="muted">暂无本地记录。</p> : history.map((run) => <article className="history-item" key={run.id}><button className="history-open" onClick={() => void openHistory(run.id)}><strong>{run.prompt.slice(0, 60)}</strong><span>{new Date(run.createdAt).toLocaleString()} · {run.status}</span></button><button className="danger" onClick={() => void removeHistory(run.id)}>删除</button></article>)}
    </section> : <>
      <section><div className="section-title"><h2>Provider</h2><button className="quiet" onClick={() => void detect()}>重新检测</button></div>
        {pages.length === 0 ? <p className="muted">正在检测模型标签页…</p> : pages.map((page) => <div key={page.providerId}><label className="provider"><input type="checkbox" disabled={page.tabId === undefined || page.status === "error" || page.status === "login_required"} checked={page.tabId !== undefined && selected.includes(page.tabId)} onChange={() => page.tabId !== undefined && setSelected((current) => current.includes(page.tabId!) ? current.filter((id) => id !== page.tabId) : [...current, page.tabId!])} /><span className={`dot ${providerProgress[page.providerId] ?? page.status}`} /><strong>{providerNames[page.providerId]}</strong><span>{providerProgress[page.providerId] ?? page.status}</span></label>{page.errorMessage && <p className="provider-error">{page.errorMessage}</p>}</div>)}
      </section>
      <section><div className="section-title"><label htmlFor="prompt"><h2>Prompt</h2></label><span className="counter">{prompt.length} 字</span></div><textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入要发送的问题…" rows={7} /><div className="actions"><button className="quiet" disabled={!prompt || busy} onClick={() => setPrompt("")}>清空</button><button className="quiet" disabled={!available || !prompt.trim() || busy} onClick={() => void run(true)}>Mock</button><button disabled={!selected.length || !prompt.trim() || busy} onClick={() => void run(false)}>{busy ? "等待回答…" : `发送到所选模型 (${selected.length})`}</button></div></section>
      {error && <p className="error" role="alert">{error}</p>}
      {bundle && <section><div className="section-title"><div><p className="eyebrow">Evaluation Run</p><h2>{bundle.run.status} · {bundle.responses.length}/{bundle.run.selectedProviders.length}</h2></div><div className="actions"><button className="quiet" disabled={busy} onClick={() => exportBundle("md")}>Markdown</button><button className="quiet" disabled={busy} onClick={() => exportBundle("json")}>JSON</button></div></div><p className="muted">{new Date(bundle.run.createdAt).toLocaleString()}</p></section>}
      {bundle?.responses.map((response) => <section key={response.id}><div className="section-title"><div><p className="eyebrow">{providerNames[response.providerId]}</p><h2>{response.modelName ?? "最新回答"}</h2></div><span className="counter">{response.metadata.durationMs ? `${(response.metadata.durationMs / 1000).toFixed(1)}s` : ""}</span></div><pre className="answer">{response.text}</pre><div className="actions"><button className="quiet" onClick={() => void navigator.clipboard.writeText(response.text)}>复制</button>{response.metadata.sourceUrl && <button className="quiet" onClick={() => void chrome.tabs.create({ url: response.metadata.sourceUrl })}>打开原网页</button>}</div></section>)}
      <section><div className="section-title"><div><p className="eyebrow">AI Judge</p><h2>匿名评审</h2></div><button className="quiet" onClick={() => void chrome.runtime.openOptionsPage()}>设置</button></div>
        {judgeMessage && <p className={judgeMessage.includes("失败") ? "error" : "judge-message"} role="status">{judgeMessage}</p>}
        {!bundle ? <><p className="muted">请先创建一次包含至少两个模型回答的 Evaluation Run。</p><button disabled>运行 Judge</button></> : busy ? <><p className="muted">正在等待各模型回答完成…</p><button disabled>运行 Judge</button></> : !bundle.judgeResult ? <><p className="muted">已收集 {bundle.responses.length} 个回答；至少需要 2 个回答才能匿名评审。</p><button disabled={bundle.responses.length < 2 || judgeBusy} onClick={() => void judgeCurrentRun()}>{judgeBusy ? "评审中…" : "运行 Judge"}</button></> : <>
          <p>{bundle.judgeResult.result.summary}</p>
          {[...bundle.judgeResult.result.ranking].sort((a, b) => a.rank - b.rank).map((rank) => <article className="history-item" key={rank.answerId}><div className="history-open"><strong>#{rank.rank} {providerNames[bundle.judgeResult!.anonymousMapping[rank.answerId]]}</strong><span>AI 评审得分 {rank.overallScore.toFixed(1)} · Judge 置信度 {rank.confidence.toFixed(0)}</span></div></article>)}
          {bundle.judgeResult.result.evaluations.map((evaluation) => <details key={evaluation.answerId}><summary>{providerNames[bundle.judgeResult!.anonymousMapping[evaluation.answerId]]} 评分详情</summary><div className="score-grid">{Object.entries(evaluation.scores).map(([key, value]) => <div className="score" key={key}><strong>{value}</strong><span>{key}</span></div>)}</div><p><strong>优点：</strong>{evaluation.strengths.join("；") || "无"}</p><p><strong>不足：</strong>{evaluation.weaknesses.join("；") || "无"}</p><p><strong>风险：</strong>{evaluation.riskFlags.map((risk) => `[${risk.severity}] ${risk.type}: ${risk.description}`).join("；") || "无"}</p><p><strong>未验证主张：</strong>{evaluation.unsupportedClaims.join("；") || "无"}</p></details>)}
          <div><h2>共识</h2><ul>{bundle.judgeResult.result.consensus.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><h2>分歧</h2><ul>{bundle.judgeResult.result.disagreements.map((item) => <li key={item.topic}>{item.topic}：{item.judgeAssessment}</li>)}</ul></div>
          <button className="quiet" disabled={judgeBusy} onClick={() => void judgeCurrentRun()}>重新评审</button>
        </>}
      </section>
      {bundle?.judgeResult && <section><p className="eyebrow">Synthesis</p><h2>综合答案</h2><select value={synthesisMode} onChange={(event) => setSynthesisMode(event.target.value as typeof synthesisMode)}><option value="best">最优综合版</option><option value="repair">修正最佳回答</option><option value="disagreements">保留分歧版</option></select><button disabled={judgeBusy} onClick={() => void synthesizeCurrentRun()}>{judgeBusy ? "生成中…" : "生成综合答案"}</button>{bundle.synthesizedAnswers?.map((answer) => <article className="synthesis-answer" key={answer.id}><div className="section-title"><strong>{answer.mode === "best" ? "最优综合版" : answer.mode === "repair" ? "修正最佳回答" : "保留分歧版"}</strong><span className="counter">{new Date(answer.createdAt).toLocaleString()}</span></div><pre className="answer">{answer.content}</pre></article>)}</section>}
    </>}
  </main>;
}
