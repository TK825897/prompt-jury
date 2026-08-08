import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiOriginPattern, loadJudgeConfig, saveJudgeConfig } from "../judge/config";
import { defaultJudgeConfig, type JudgeConfig, type JudgeWeights } from "../judge/schemas";
import "../sidepanel/styles.css";

const weightLabels: Record<keyof JudgeWeights, string> = {
  factuality: "事实性", completeness: "完整性", logic: "逻辑性", actionability: "可执行性",
  riskAwareness: "风险意识", writingQuality: "表达质量",
};

export function Options() {
  const [config, setConfig] = useState<JudgeConfig>(defaultJudgeConfig);
  const [message, setMessage] = useState("");
  useEffect(() => { void loadJudgeConfig().then(setConfig); }, []);
  const total = Object.values(config.weights).reduce((sum, value) => sum + value, 0);

  async function save() {
    setMessage("");
    try {
      if (total !== 100) throw new Error(`评分权重合计必须为 100%，当前为 ${total}%`);
      if (!config.model.trim()) throw new Error("请填写 Judge 模型名称");
      const origin = apiOriginPattern(config.baseUrl);
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error(`未授予 ${origin} 的 API 访问权限`);
      await saveJudgeConfig({ ...config, baseUrl: config.baseUrl.replace(/\/$/, "") });
      setMessage("Judge 配置已仅保存在本机浏览器中。");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "保存失败"); }
  }

  return <main><header><p className="eyebrow">Local first · v{chrome.runtime.getManifest().version}</p><h1>Judge 设置</h1><p>API Key 仅保存在浏览器本地，不写入运行历史或导出文件。</p></header>
    <section className="settings-grid">
      <label>Base URL 或完整 Chat Completions URL<input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} /></label>
      <label>API Key<input type="password" value={config.apiKey} onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} /></label>
      <label>Model<input value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} placeholder="gpt-4.1-mini" /></label>
      <label>Temperature<input type="number" min="0" max="2" step="0.1" value={config.temperature} onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })} /></label>
      <label>Max Tokens<input type="number" min="256" value={config.maxTokens} onChange={(event) => setConfig({ ...config, maxTokens: Number(event.target.value) })} /></label>
    </section>
    <section><div className="section-title"><h2>评分权重</h2><strong className={total === 100 ? "valid" : "invalid"}>{total}%</strong></div><div className="weights">{Object.entries(weightLabels).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" max="100" value={config.weights[key as keyof JudgeWeights]} onChange={(event) => setConfig({ ...config, weights: { ...config.weights, [key]: Number(event.target.value) } })} /></label>)}</div></section>
    {message && <p className={message.includes("已仅保存") ? "success" : "error"}>{message}</p>}
    <div className="actions"><button onClick={() => void save()}>保存 Judge 配置</button></div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Options /></StrictMode>);
