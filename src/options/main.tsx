import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiOriginPattern, loadJudgeConfig, saveJudgeConfig } from "../judge/config";
import { defaultJudgeConfig, type JudgeConfig, type JudgeWeights } from "../judge/schemas";
import { useUiLanguage, type MessageKey } from "../i18n";
import "../sidepanel/styles.css";

const weightKeys: Record<keyof JudgeWeights, MessageKey> = {
  factuality: "factuality", completeness: "completeness", logic: "logic", actionability: "actionability",
  riskAwareness: "riskAwareness", writingQuality: "writingQuality",
};

export function Options() {
  const { t, toggleLanguage } = useUiLanguage();
  const [config, setConfig] = useState<JudgeConfig>(defaultJudgeConfig);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { void loadJudgeConfig().then(setConfig); }, []);
  useEffect(() => { document.title = `Prompt Jury · ${t("judgeSettings")}`; }, [t]);
  const total = Object.values(config.weights).reduce((sum, value) => sum + value, 0);

  async function save() {
    setMessage("");
    setSaved(false);
    try {
      if (total !== 100) throw new Error(t("weightsTotal", { total }));
      if (!config.model.trim()) throw new Error(t("modelRequired"));
      const origin = apiOriginPattern(config.baseUrl);
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error(t("permissionDenied", { origin }));
      await saveJudgeConfig({ ...config, baseUrl: config.baseUrl.replace(/\/$/, "") });
      setSaved(true); setMessage(t("configSaved"));
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : t("saveFailed")); }
  }

  return <main><header><div className="header-tools"><p className="eyebrow">Local first · v{chrome.runtime.getManifest().version}</p><button className="quiet language-toggle" onClick={toggleLanguage}>{t("languageName")}</button></div><h1>{t("judgeSettings")}</h1><p>{t("localKeyNotice")}</p></header>
    <section className="settings-grid">
      <label>{t("endpointLabel")}<input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} /></label>
      <label>API Key<input type="password" value={config.apiKey} onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} /></label>
      <label>Model<input value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} placeholder="gpt-4.1-mini" /></label>
      <label>Temperature<input type="number" min="0" max="2" step="0.1" value={config.temperature} onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })} /></label>
      <label>Max Tokens<input type="number" min="256" value={config.maxTokens} onChange={(event) => setConfig({ ...config, maxTokens: Number(event.target.value) })} /></label>
    </section>
    <section><div className="section-title"><h2>{t("scoringWeights")}</h2><strong className={total === 100 ? "valid" : "invalid"}>{total}%</strong></div><div className="weights">{Object.entries(weightKeys).map(([key, messageKey]) => <label key={key}>{t(messageKey)}<input type="number" min="0" max="100" value={config.weights[key as keyof JudgeWeights]} onChange={(event) => setConfig({ ...config, weights: { ...config.weights, [key]: Number(event.target.value) } })} /></label>)}</div></section>
    {message && <p className={saved ? "success" : "error"}>{message}</p>}
    <div className="actions"><button onClick={() => void save()}>{t("saveJudge")}</button></div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Options /></StrictMode>);
