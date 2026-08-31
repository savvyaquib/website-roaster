/**
 * Phase 4 — DOM analyzer.
 *
 * Import from `@/lib/analysis/dom`; the internal modules are implementation
 * detail.
 */

export { extractPageData } from "./extract-page-data";

export { classifyLink, hostOf, resolveBaseUrl, resolveUrl } from "./urls";

export type {
  FormFieldData,
  HeadingData,
  HeadingLevel,
  ImageData,
  LinkData,
  LinkKind,
  PageData,
  PageFormData,
  ScriptData,
  StylesheetData,
} from "./types";
