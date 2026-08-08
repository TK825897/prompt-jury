# Prompt Jury

English | [简体中文](README_ZH.md)

> Compare multiple LLM responses, judge the differences, and synthesize the best answer.

Prompt Jury is a Chrome / Edge Manifest V3 browser extension. The current MVP includes the project foundation, end-to-end messaging, adapters for four LLM platforms, Evaluation Runs, local history, exports, anonymous AI judging, and answer synthesis.

## Features

- Automatically detects open, signed-in tabs for ChatGPT, Gemini, Kimi, and Doubao;
- Automatically uses Chinese or English based on the browser UI language, with manual switching available at any time;
- Sends a single prompt to any number of selected platforms in parallel;
- Tracks generation status independently, so a failure or timeout on one platform does not interrupt the others;
- Extracts the latest response from each platform and displays all responses together in the Side Panel;
- Saves prompts, responses, durations, and failure details as local Evaluation Runs;
- Lets you view and delete run history or export complete results as Markdown or JSON;
- Anonymously evaluates candidate responses through a user-configured OpenAI-compatible API;
- Displays scores, rankings, strengths, weaknesses, risks, consensus, and disagreements;
- Generates and separately saves three synthesis variants: Best Integrated Answer, Repair Best Answer, and Preserve Disagreements.

## User Guide

### 1. Prepare the LLM pages

Open and sign in to the platforms you want to compare. Prompt Jury supports:

- ChatGPT: `https://chatgpt.com/`;
- Gemini: `https://gemini.google.com/app`;
- Kimi: `https://www.kimi.com/` or `https://kimi.moonshot.cn/`;
- Doubao: `https://www.doubao.com/`.

If an LLM page was already open before the extension was installed or updated, refresh the page so the Content Script can be injected again. Keep the corresponding tabs open while responses are being generated.

### 2. Collect responses from multiple LLMs

1. Click the Prompt Jury icon in the browser toolbar to open the Side Panel;
2. On first use, the extension follows the browser UI language. Click `English` or `中文` in the upper-right corner to switch manually;
3. Check the Provider list and make sure the platforms you want to use are available for selection;
4. Select at least two platforms;
5. Enter your question once in the Prompt field;
6. Click **Send to selected models** (`发送到所选模型`);
7. Wait for the platforms to finish. Their responses will appear in the same Evaluation Run as they complete.

If a Provider shows `not_open`, open and sign in to that platform, then click **Detect again** (`重新检测`). If it shows `error`, review the details below the Provider and first try refreshing the LLM page and reloading the extension.

### 3. View history and export results

- Click **History** (`历史`) at the top to view Evaluation Runs saved on this device;
- Open a history entry to restore its prompt, responses, Judge result, and synthesized answers;
- Click **Markdown** or **JSON** in the Evaluation Run section to download the complete result;
- Delete runs you no longer need from the history list.

### 4. Configure the AI Judge

1. Click **Settings** (`设置`) in the **AI Judge** section of the Side Panel;
2. Enter the Base URL or full Chat Completions URL of an OpenAI-compatible API;
3. Enter the API Key, Model, Temperature, and Max Tokens;
4. Adjust the six scoring weights if needed, keeping their total at 100%;
5. Click **Save Judge configuration** (`保存 Judge 配置`) and allow the extension to access the API address.

The Judge configuration is stored locally in the browser. The API Key is never written to run history or export files. When you run the Judge or generate a synthesized answer, the current prompt and candidate responses are sent to the API you configured.

### 5. Run the Judge and synthesize an answer

1. Make sure the current Evaluation Run contains at least two successfully collected responses;
2. Click **Run Judge** (`运行 Judge`) and wait for the anonymous evaluation to finish;
3. Review each response's ranking, scores, strengths, weaknesses, risks, consensus, and disagreements;
4. Select a synthesis mode and click **Generate synthesized answer** (`生成综合答案`);
5. You can generate each synthesis mode in turn. Existing results are not overwritten and remain stored locally with the current run.

## Development

Node.js 20+ and npm are required.

```bash
npm install
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
```

`npm run dev` starts Vite in watch mode. Changes to the Manifest or extension entry points may require reloading the extension from the browser's extension management page.

## Local Installation

1. Run `npm install`;
2. Run `npm run build`;
3. Open `chrome://extensions/` in Chrome or `edge://extensions/` in Edge;
4. Enable Developer mode;
5. Click **Load unpacked**;
6. Select the generated `dist` directory;
7. Pin the extension, then open and sign in to ChatGPT, Gemini, Kimi, or Doubao;
8. Click the extension icon to open the Side Panel.

If a platform page was already open before the extension was installed, refresh it so the Content Script can be injected.

The Side Panel always displays detection results for all four platforms. `not_open` means no matching tab is open. `error` usually means the page has not been refreshed since the extension was updated; detailed error information is displayed below the Provider.

Production builds bundle each platform's Content Script as a standalone IIFE to support the security policies of different sites.

### Known Issue: Edge cannot execute the Gemini Content Script

In some Microsoft Edge environments, the extension detects an open `https://gemini.google.com/app` tab, but Edge blocks Content Script execution and reports `Edge blocked script execution (Blocked)`. The issue may persist even when:

- The extension details page automatically allows access to `https://*.gemini.google.com/*`;
- `edge://policy` contains no policy restricting the extension or script execution;
- The Gemini tab is awake, has not been discarded, and has been refreshed;
- Temporary `activeTab` permission has been granted by clicking the extension icon.

The same build detects and uses Gemini normally in Chrome, so this is currently documented as an Edge-specific compatibility issue with no additional MVP workaround. If you encounter it, use Chrome for Gemini testing. ChatGPT, Kimi, and Doubao remain available in Edge.

The default response timeout is 180 seconds. Because Kimi's deep-thinking mode can take longer, the Kimi Adapter uses a 300-second timeout. Polling remains frequent so completed responses can be returned promptly.

ChatGPT web-search responses may render citations first and append the main text after a pause. Prompt Jury therefore waits for the text to remain stable for about 10 seconds and applies an additional 1.5-second buffer before extraction.

## Verify the Messaging Flow

Open a ChatGPT tab, enter any text in the Side Panel, and click **Mock**. The request travels from the Side Panel to the Background Service Worker, then to the Content Script, and back through the same path. Mock mode does not submit text to ChatGPT.

Select one or more platforms and click **Send to selected models** (`发送到所选模型`) to invoke their adapters in parallel. A failure on one platform does not interrupt the others. Selectors for each platform are maintained in its corresponding `src/adapters/*-adapter.ts` file.

## Architecture

- `src/adapters/`: isolated platform adapter interfaces, registry, and DOM selectors;
- `src/background/`: tab discovery and cross-context message routing;
- `src/content/`: page injection entry points that invoke adapters;
- `src/messaging/`: Zod schemas and types for all cross-context messages;
- `src/sidepanel/` and `src/options/`: React user interfaces;
- `src/storage/`: IndexedDB wrapper;
- `tests/unit/`: Vitest unit tests.

The extension does not depend on a custom backend, read or upload cookies, or log prompts and responses to the console. Its fixed Manifest `host_permissions` cover only the currently supported ChatGPT, Gemini, Kimi, and Doubao pages. When you configure an OpenAI-compatible Judge, the extension requests optional Host Permission for that API address. The current prompt and candidate responses are sent to the configured API only when you run the Judge or generate a synthesized answer. The API Key and run history remain stored only in the local browser and are never written to export files.
