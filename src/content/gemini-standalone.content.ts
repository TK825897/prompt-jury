// Keep a standalone bundled entry for Gemini because Edge can reject CRXJS's
// loader indirection on this origin. The shared handler itself is bundled into
// dist/content/gemini.js and registers synchronously.
import { installContentHandler } from "./install-content-handler";

installContentHandler();
