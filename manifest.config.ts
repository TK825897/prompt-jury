import { defineManifest } from "@crxjs/vite-plugin";
import packageJson from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Prompt Jury",
  description: "Compare multiple LLM responses, judge the differences, and synthesize the best answer.",
  version: packageJson.version,
  minimum_chrome_version: "114",
  permissions: ["sidePanel", "tabs", "storage", "scripting", "activeTab"],
  host_permissions: [
    "https://chatgpt.com/*",
    "https://*.chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://gemini.google.com/*",
    "https://kimi.moonshot.cn/*",
    "https://www.kimi.com/*",
    "https://kimi.com/*",
    "https://www.doubao.com/*",
    "https://doubao.com/*",
  ],
  optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  action: { default_title: "Open Prompt Jury" },
  background: { service_worker: "src/background/service-worker.ts", type: "module" },
  side_panel: { default_path: "sidepanel.html" },
  options_page: "options.html",
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*", "https://*.chatgpt.com/*", "https://chat.openai.com/*"],
      js: ["src/content/chatgpt.content.ts"],
      run_at: "document_idle",
    },
    {
      matches: ["https://gemini.google.com/*"],
      js: ["src/content/gemini.content.ts"],
      run_at: "document_idle",
      world: "ISOLATED",
    },
    { matches: ["https://kimi.moonshot.cn/*", "https://www.kimi.com/*", "https://kimi.com/*"], js: ["src/content/kimi.content.ts"], run_at: "document_idle" },
    { matches: ["https://www.doubao.com/*", "https://doubao.com/*"], js: ["src/content/doubao.content.ts"], run_at: "document_idle" },
  ],
});
