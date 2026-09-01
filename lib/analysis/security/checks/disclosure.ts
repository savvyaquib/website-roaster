/**
 * Server and technology disclosure.
 *
 * ## Proportion
 *
 * Disclosure is not a vulnerability. Knowing a site runs nginx does not let
 * anyone in, and hiding it does not keep anyone out — the findings here are
 * `minor` for that reason.
 *
 * What it does is save an attacker the trouble of fingerprinting, and a
 * *version* number turns "what is this running?" into "which published
 * vulnerabilities apply?". That is why a version is reported and a bare product
 * name is not.
 */

import type { HttpResponseData } from "@/lib/analysis/http";
import type { Finding } from "@/lib/types/finding";

import { httpEvidence, preview, securityFinding } from "../finding-builder";
import { TECHNOLOGY_HEADERS, VERSION_PATTERN } from "../thresholds";

export function checkServerDisclosure(response: HttpResponseData): Finding[] {
  const findings: Finding[] = [];

  const server = response.headers["server"];

  if (server !== undefined && VERSION_PATTERN.test(server)) {
    findings.push(
      securityFinding({
        id: "security.disclosure.server_version",
        severity: "minor",
        status: "warn",
        evidence: [
          httpEvidence("The Server header includes a version.", preview(server)),
        ],
        explanation:
          "Publishing the exact version tells anyone scanning the site which published vulnerabilities to try first. It is not itself a weakness, and removing it is not a substitute for patching.",
        recommendation:
          "Configure the server to report its product without a version, or to omit the header.",
      }),
    );
  }

  const disclosed = TECHNOLOGY_HEADERS.filter(
    (name) => response.headers[name] !== undefined,
  );

  if (disclosed.length > 0) {
    findings.push(
      securityFinding({
        id: "security.disclosure.technology_headers",
        severity: "minor",
        status: "warn",
        evidence: disclosed.map((name) =>
          httpEvidence(`${name} is present.`, preview(response.headers[name] ?? "")),
        ),
        explanation:
          "These headers name the framework or runtime behind the site. They serve no purpose for visitors and narrow down what an attacker needs to guess.",
        recommendation: `Remove ${disclosed.join(", ")} from responses.`,
      }),
    );
  }

  if (findings.length > 0) return findings;

  return [
    securityFinding({
      id: "security.disclosure.minimal",
      severity: "info",
      status: "pass",
      evidence: [
        httpEvidence(
          server === undefined
            ? "No Server header was sent, and no technology headers were found."
            : `The Server header discloses no version.`,
          server === undefined ? undefined : preview(server),
        ),
      ],
      explanation:
        "The response does not advertise specific software versions. This is a small obstacle to fingerprinting, not a protection in itself.",
      recommendation:
        "Keep version details out of response headers as the stack changes.",
    }),
  ];
}
