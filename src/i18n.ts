import { useCallback, useEffect, useState } from "react";

export type UiLanguage = "zh" | "en";

const storageKey = "uiLanguage";

const messages = {
  zh: {
    languageName: "English",
    run: "运行",
    history: "历史",
    historyRuns: "历史运行",
    refresh: "刷新",
    noHistory: "暂无本地记录。",
    delete: "删除",
    detectAgain: "重新检测",
    detecting: "正在检测模型标签页…",
    characters: "字",
    promptPlaceholder: "输入要发送的问题…",
    clear: "清空",
    waitingResponses: "等待回答…",
    sendSelected: "发送到所选模型",
    latestResponse: "最新回答",
    copy: "复制",
    openSource: "打开原网页",
    anonymousReview: "匿名评审",
    settings: "设置",
    needRun: "请先创建一次包含至少两个模型回答的 Evaluation Run。",
    selectJudge: "选择 Judge",
    apiJudge: "OpenAI-compatible API",
    chatgptWebJudge: "ChatGPT 临时聊天",
    geminiWebJudge: "Gemini 临时聊天",
    kimiWebJudge: "Kimi 临时聊天",
    doubaoWebJudge: "豆包临时聊天",
    temporarilyUnavailable: "不可用",
    apiJudgeHelp: "使用设置页面中配置的 API，独立请求且不复用上下文。",
    chatgptWebJudgeHelp: "使用已登录的 ChatGPT 临时聊天，评审后自动关闭。",
    geminiWebJudgeHelp: "使用 Gemini 官方临时聊天；仅支持个人 Google 账号。",
    kimiWebJudgeHelp: "Kimi 网页版目前不提供可验证的临时/无痕会话。",
    doubaoWebJudgeHelp: "豆包网页版目前不提供可验证的临时/无痕会话。",
    judgeRunCount: "已保存 {count} 次 Judge 结果",
    currentJudge: "当前 Judge",
    viewJudgeResult: "查看 Judge 结果",
    waitingModels: "正在等待各模型回答完成…",
    collected: "已收集 {count} 个回答；至少需要 2 个回答才能匿名评审。",
    runJudge: "运行 Judge",
    judging: "评审中…",
    judgeScore: "AI 评审得分",
    confidence: "Judge 置信度",
    scoreDetails: "评分详情",
    strengths: "优点",
    weaknesses: "不足",
    risks: "风险",
    unsupported: "未验证主张",
    none: "无",
    consensus: "共识",
    disagreements: "分歧",
    rerunJudge: "重新评审",
    synthesis: "综合答案",
    best: "最优综合版",
    repair: "修正最佳回答",
    preserve: "保留分歧版",
    generating: "生成中…",
    generateSynthesis: "生成综合答案",
    detectFailed: "检测失败",
    createRunFailed: "无法创建本地运行记录",
    dbWriteFailed: "IndexedDB 写入失败",
    invalidResponse: "返回的数据类型不正确",
    unknownError: "未知错误",
    localSaveFailed: "本地保存失败",
    readingJudge: "正在读取 Judge 配置…",
    configureJudge: "请先在 Judge 设置中配置 API Key 和 Model。",
    callingJudge: "正在调用 {model} 进行匿名评审…",
    callingWebJudge: "正在创建 {provider} 并进行匿名评审…",
    webJudgeUnavailable: "所选 Web Judge 不可用。请打开并登录对应平台后重试。",
    sessionCreateFailed: "无法创建临时 Judge 会话，请重试。",
    sessionCleanupFailed: "评审已结束，但临时标签页未能自动关闭，请手动关闭。",
    webResponseInvalid: "Web Judge 返回的结果无法解析，请重试。",
    savingJudge: "评审完成，正在保存本地结果…",
    judgeSaved: "Judge 已完成并保存。",
    judgeFailed: "Judge 失败",
    generatingSynthesis: "正在生成综合答案…",
    configureJudgeApi: "请先配置 Judge API。",
    synthesisSaved: "综合答案已生成并保存。",
    synthesisFailed: "综合答案失败",
    judgeSettings: "Judge 设置",
    localKeyNotice: "API Key 仅保存在浏览器本地，不写入运行历史或导出文件。",
    endpointLabel: "Base URL 或完整 Chat Completions URL",
    scoringWeights: "评分权重",
    saveJudge: "保存 Judge 配置",
    weightsTotal: "评分权重合计必须为 100%，当前为 {total}%",
    modelRequired: "请填写 Judge 模型名称",
    permissionDenied: "未授予 {origin} 的 API 访问权限",
    configSaved: "Judge 配置已仅保存在本机浏览器中。",
    saveFailed: "保存失败",
    factuality: "事实性",
    completeness: "完整性",
    logic: "逻辑性",
    actionability: "可执行性",
    riskAwareness: "风险意识",
    writingQuality: "表达质量",
    status_not_open: "未打开",
    status_ready: "就绪",
    status_error: "错误",
    status_login_required: "需要登录",
    status_sending: "发送中",
    status_generating: "生成中",
    status_completed: "已完成",
    status_timeout: "超时",
    status_failed: "失败",
    status_running: "运行中",
    status_partial: "部分完成",
  },
  en: {
    languageName: "中文",
    run: "Run",
    history: "History",
    historyRuns: "Run history",
    refresh: "Refresh",
    noHistory: "No local runs yet.",
    delete: "Delete",
    detectAgain: "Detect again",
    detecting: "Detecting LLM tabs…",
    characters: "characters",
    promptPlaceholder: "Enter a question to send…",
    clear: "Clear",
    waitingResponses: "Waiting for responses…",
    sendSelected: "Send to selected models",
    latestResponse: "Latest response",
    copy: "Copy",
    openSource: "Open source page",
    anonymousReview: "Anonymous review",
    settings: "Settings",
    needRun:
      "Create an Evaluation Run with at least two model responses first.",
    selectJudge: "Select Judge",
    apiJudge: "OpenAI-compatible API",
    chatgptWebJudge: "ChatGPT Temporary Chat",
    geminiWebJudge: "Gemini Temporary Chat",
    kimiWebJudge: "Kimi Temporary Chat",
    doubaoWebJudge: "Doubao Temporary Chat",
    temporarilyUnavailable: "Unavailable",
    apiJudgeHelp:
      "Uses the API configured in Settings with an independent, stateless request.",
    chatgptWebJudgeHelp:
      "Uses signed-in ChatGPT Temporary Chat and closes it after review.",
    geminiWebJudgeHelp:
      "Uses Gemini's official Temporary Chat; personal Google Accounts only.",
    kimiWebJudgeHelp:
      "Kimi Web currently provides no verifiable temporary or incognito session.",
    doubaoWebJudgeHelp:
      "Doubao Web currently provides no verifiable temporary or incognito session.",
    judgeRunCount: "{count} Judge result(s) saved",
    currentJudge: "Current Judge",
    viewJudgeResult: "View Judge result",
    waitingModels: "Waiting for all model responses…",
    collected:
      "Collected {count} response(s); at least 2 are required for anonymous review.",
    runJudge: "Run Judge",
    judging: "Judging…",
    judgeScore: "AI Judge score",
    confidence: "Judge confidence",
    scoreDetails: "score details",
    strengths: "Strengths",
    weaknesses: "Weaknesses",
    risks: "Risks",
    unsupported: "Unsupported claims",
    none: "None",
    consensus: "Consensus",
    disagreements: "Disagreements",
    rerunJudge: "Run Judge again",
    synthesis: "Synthesized answer",
    best: "Best integrated answer",
    repair: "Repair best answer",
    preserve: "Preserve disagreements",
    generating: "Generating…",
    generateSynthesis: "Generate synthesized answer",
    detectFailed: "Detection failed",
    createRunFailed: "Could not create a local run",
    dbWriteFailed: "IndexedDB write failed",
    invalidResponse: "Invalid response data",
    unknownError: "Unknown error",
    localSaveFailed: "Local save failed",
    readingJudge: "Loading Judge configuration…",
    configureJudge: "Configure an API Key and Model in Judge settings first.",
    callingJudge: "Calling {model} for anonymous review…",
    callingWebJudge: "Creating {provider} for anonymous review…",
    webJudgeUnavailable:
      "The selected Web Judge is unavailable. Open and sign in to that provider, then retry.",
    sessionCreateFailed:
      "Could not create a temporary Judge session. Please retry.",
    sessionCleanupFailed:
      "The review finished, but the temporary tab could not be closed. Close it manually.",
    webResponseInvalid:
      "The Web Judge returned a result that could not be parsed. Please retry.",
    savingJudge: "Review complete; saving the result locally…",
    judgeSaved: "Judge completed and saved.",
    judgeFailed: "Judge failed",
    generatingSynthesis: "Generating a synthesized answer…",
    configureJudgeApi: "Configure the Judge API first.",
    synthesisSaved: "Synthesized answer generated and saved.",
    synthesisFailed: "Synthesis failed",
    judgeSettings: "Judge settings",
    localKeyNotice:
      "The API Key is stored only in this browser and is never written to run history or exports.",
    endpointLabel: "Base URL or full Chat Completions URL",
    scoringWeights: "Scoring weights",
    saveJudge: "Save Judge configuration",
    weightsTotal: "Scoring weights must total 100%; current total: {total}%",
    modelRequired: "Enter a Judge model name",
    permissionDenied: "Access to the API at {origin} was not granted",
    configSaved: "Judge configuration saved only in this browser.",
    saveFailed: "Save failed",
    factuality: "Factuality",
    completeness: "Completeness",
    logic: "Logic",
    actionability: "Actionability",
    riskAwareness: "Risk awareness",
    writingQuality: "Writing quality",
    status_not_open: "Not open",
    status_ready: "Ready",
    status_error: "Error",
    status_login_required: "Sign-in required",
    status_sending: "Sending",
    status_generating: "Generating",
    status_completed: "Completed",
    status_timeout: "Timed out",
    status_failed: "Failed",
    status_running: "Running",
    status_partial: "Partially completed",
  },
} as const;

export type MessageKey = keyof typeof messages.en;

function browserLanguage(): UiLanguage {
  const locale =
    typeof chrome !== "undefined" && chrome.i18n?.getUILanguage
      ? chrome.i18n.getUILanguage()
      : navigator.language;
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function useUiLanguage() {
  const [language, setLanguage] = useState<UiLanguage>(browserLanguage);
  useEffect(() => {
    void chrome.storage.local.get(storageKey).then((stored) => {
      if (stored[storageKey] === "zh" || stored[storageKey] === "en")
        setLanguage(stored[storageKey]);
    });
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
    ) => {
      const value = changes[storageKey]?.newValue;
      if (value === "zh" || value === "en") setLanguage(value);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);
  const t = useCallback(
    (key: MessageKey, variables?: Record<string, string | number>) => {
      let value: string = messages[language][key];
      for (const [name, replacement] of Object.entries(variables ?? {}))
        value = value.replaceAll(`{${name}}`, String(replacement));
      return value;
    },
    [language],
  );
  const toggleLanguage = useCallback(() => {
    const next = language === "zh" ? "en" : "zh";
    setLanguage(next);
    void chrome.storage.local.set({ [storageKey]: next });
  }, [language]);
  return { language, t, toggleLanguage };
}
