/**
 * Finding helpers for the security analyzer.
 *
 * Thin wrapper over the shared builder so the checks read cleanly.
 */

import { findingFactory } from "@/lib/analysis/finding-builder";

export { derivedEvidence, httpEvidence, preview } from "@/lib/analysis/finding-builder";

export const securityFinding = findingFactory("security");
