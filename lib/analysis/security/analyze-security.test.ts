import { describe, expect, it } from "vitest";

import type { HttpResponseData } from "@/lib/analysis/http";
import type { Finding } from "@/lib/types/finding";

import { analyzeSecurity } from "./analyze-security";
import { HSTS_MIN_MAX_AGE_SECONDS } from "./thresholds";

/** A response with every protective header set, so tests can break one thing. */
function response(overrides: Partial<HttpResponseData> = {}): HttpResponseData {
  return {
    finalUrl: "https://example.com/",
    status: 200,
    statusText: "OK",
    headers: {
      "content-type": "text/html",
      "strict-transport-security": `max-age=${HSTS_MIN_MAX_AGE_SECONDS}; includeSubDomains`,
      "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
    setCookie: [],
    contentType: "text/html",
    charset: "utf-8",
    isHtml: true,
    body: "<html></html>",
    contentLength: null,
    transferredBytes: 13,
    decodedBytes: 13,
    contentEncoding: null,
    redirects: [],
    timing: {
      dnsMs: null,
      connectMs: null,
      tlsMs: null,
      ttfbMs: null,
      downloadMs: null,
      totalMs: 10,
    },
    totalElapsedMs: 10,
    ...overrides,
  };
}

/** Replace headers wholesale rather than merging, so a test can remove one. */
function withHeaders(headers: Record<string, string>): HttpResponseData {
  return response({ headers });
}

function byId(findings: readonly Finding[], id: string): Finding | undefined {
  return findings.find((finding) => finding.id === id);
}

function ids(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.id);
}

const GOOD = response();

describe("the analyzer contract", () => {
  const findings = analyzeSecurity({ response: GOOD });

  it("emits only security findings", () => {
    expect(findings.every((finding) => finding.category === "security")).toBe(true);
  });

  it("gives every finding evidence and a recommendation", () => {
    for (const finding of findings) {
      expect(finding.evidence.length, `${finding.id} has no evidence`).toBeGreaterThan(0);
      expect(
        (finding.recommendation ?? "").length,
        `${finding.id} has no recommendation`,
      ).toBeGreaterThan(0);
      expect(finding.explanation.length).toBeGreaterThan(0);
    }
  });

  it("uses unique finding ids", () => {
    expect(new Set(ids(findings)).size).toBe(findings.length);
  });

  it("produces no score", () => {
    for (const finding of findings) {
      expect(finding).not.toHaveProperty("score");
    }
  });

  it("is deterministic", () => {
    expect(analyzeSecurity({ response: GOOD })).toEqual(
      analyzeSecurity({ response: GOOD }),
    );
  });

  it("reports transport before the headers that depend on it", () => {
    expect(findings[0]?.id).toMatch(/^security\.https\./);
    expect(findings[1]?.id).toMatch(/^security\.hsts\./);
  });
});

describe("it never claims the site is secure", () => {
  // The rule that keeps this report honest. Everything here is read from
  // response metadata; none of it can support a statement about whether the
  // application behind it is safe.
  const claims = [
    /\bis secure\b/i,
    /\bfully secure\b/i,
    /\bcompletely secure\b/i,
    /\bis safe\b/i,
    /\bno vulnerabilit/i,
    /\bnot vulnerable\b/i,
    /\bsecure site\b/i,
    /\bsecure website\b/i,
    /\bguarantee/i,
    /\bprotected against all\b/i,
  ];

  const scenarios: Array<[string, HttpResponseData]> = [
    ["a fully configured response", GOOD],
    ["a bare response", withHeaders({})],
    ["a plain HTTP response", response({ finalUrl: "http://example.com/", headers: {} })],
    [
      "a response with cookies",
      response({ setCookie: ["a=1; Secure; HttpOnly; SameSite=Lax"] }),
    ],
    [
      "a response disclosing its stack",
      response({ headers: { server: "nginx/1.24.0", "x-powered-by": "Express" } }),
    ],
  ];

  it.each(scenarios)("makes no safety claim for %s", (_label, target) => {
    const text = analyzeSecurity({ response: target })
      .flatMap((finding) => [
        finding.explanation,
        finding.recommendation ?? "",
        ...finding.evidence.map((item) => item.summary),
      ])
      .join("\n");

    for (const claim of claims) {
      expect(text, `matched ${claim}`).not.toMatch(claim);
    }
  });

  it("describes a pass as configuration, not as safety", () => {
    const finding = byId(analyzeSecurity({ response: GOOD }), "security.https.present");

    expect(finding?.status).toBe("pass");
    expect(finding?.explanation).toContain("says nothing about");
  });
});

describe("HTTPS", () => {
  it("treats plain HTTP as critical", () => {
    const finding = byId(
      analyzeSecurity({ response: response({ finalUrl: "http://example.com/" }) }),
      "security.https.absent",
    );

    expect(finding?.severity).toBe("critical");
    expect(finding?.status).toBe("fail");
  });

  it("passes on HTTPS", () => {
    expect(
      byId(analyzeSecurity({ response: GOOD }), "security.https.present")?.status,
    ).toBe("pass");
  });

  it("notes an HTTP request that was upgraded to HTTPS", () => {
    const finding = byId(
      analyzeSecurity({
        response: response({
          redirects: [
            {
              url: "http://example.com/",
              status: 301,
              location: "https://example.com/",
              elapsedMs: 5,
            },
          ],
        }),
      }),
      "security.https.present",
    );

    expect(finding?.evidence.map((item) => item.summary).join(" ")).toContain(
      "redirected to HTTPS",
    );
  });
});

describe("HSTS", () => {
  it("fails when absent on an HTTPS page", () => {
    const finding = byId(
      analyzeSecurity({ response: withHeaders({}) }),
      "security.hsts.absent",
    );

    expect(finding?.status).toBe("fail");
  });

  it("cannot assess HSTS on a plain HTTP page", () => {
    // A browser ignores HSTS delivered over HTTP, so there is nothing to judge.
    const finding = byId(
      analyzeSecurity({ response: response({ finalUrl: "http://example.com/" }) }),
      "security.hsts.not_applicable",
    );

    expect(finding?.status).toBe("could_not_determine");
  });

  it("fails when max-age is zero", () => {
    const finding = byId(
      analyzeSecurity({
        response: withHeaders({ "strict-transport-security": "max-age=0" }),
      }),
      "security.hsts.disabled",
    );

    expect(finding?.status).toBe("fail");
  });

  it("fails when there is no readable max-age", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({ "strict-transport-security": "includeSubDomains" }),
        }),
        "security.hsts.no_max_age",
      )?.status,
    ).toBe("fail");
  });

  it("warns about a short max-age", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({ "strict-transport-security": "max-age=3600" }),
        }),
        "security.hsts.short_max_age",
      )?.status,
    ).toBe("warn");
  });

  it("warns when subdomains are not covered", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({
            "strict-transport-security": `max-age=${HSTS_MIN_MAX_AGE_SECONDS}`,
          }),
        }),
        "security.hsts.no_subdomains",
      )?.status,
    ).toBe("warn");
  });
});

describe("Content-Security-Policy", () => {
  it("fails when absent", () => {
    expect(
      byId(analyzeSecurity({ response: withHeaders({}) }), "security.csp.absent")?.status,
    ).toBe("fail");
  });

  it("warns when only report-only is sent", () => {
    // A report-only policy blocks nothing, so it protects nothing yet.
    const finding = byId(
      analyzeSecurity({
        response: withHeaders({
          "content-security-policy-report-only": "default-src 'self'",
        }),
      }),
      "security.csp.report_only",
    );

    expect(finding?.status).toBe("warn");
  });

  it("warns about unsafe-inline in the script sources", () => {
    const finding = byId(
      analyzeSecurity({
        response: withHeaders({
          "content-security-policy": "script-src 'self' 'unsafe-inline'",
        }),
      }),
      "security.csp.unsafe_script_sources",
    );

    expect(finding?.status).toBe("warn");
    expect(finding?.evidence[1]?.summary).toContain("unsafe-inline");
  });

  it("finds unsafe sources inherited through default-src", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({
            "content-security-policy": "default-src 'self' 'unsafe-eval'",
          }),
        }),
        "security.csp.unsafe_script_sources",
      ),
    ).toBeDefined();
  });

  it("warns when the policy restricts no script sources", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({ "content-security-policy": "img-src 'self'" }),
        }),
        "security.csp.no_script_restriction",
      )?.status,
    ).toBe("warn");
  });

  it("passes a policy that restricts scripts", () => {
    expect(
      byId(analyzeSecurity({ response: GOOD }), "security.csp.present")?.status,
    ).toBe("pass");
  });
});

describe("frame protection", () => {
  it("fails when neither mechanism is present", () => {
    const finding = byId(
      analyzeSecurity({ response: withHeaders({}) }),
      "security.frame_protection.absent",
    );

    expect(finding?.status).toBe("fail");
    expect(finding?.explanation).toContain("clickjacking");
  });

  it("prefers frame-ancestors and does not also demand the legacy header", () => {
    const findings = analyzeSecurity({ response: GOOD });

    expect(byId(findings, "security.frame_protection.csp")?.status).toBe("pass");
    expect(byId(findings, "security.frame_protection.absent")).toBeUndefined();
  });

  it("accepts the legacy header on its own", () => {
    expect(
      byId(
        analyzeSecurity({ response: withHeaders({ "x-frame-options": "SAMEORIGIN" }) }),
        "security.frame_protection.legacy",
      )?.status,
    ).toBe("pass");
  });

  it("warns about the unsupported ALLOW-FROM form", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({ "x-frame-options": "ALLOW-FROM https://a.example" }),
        }),
        "security.frame_protection.deprecated",
      )?.status,
    ).toBe("warn");
  });

  it("warns about an unrecognised value", () => {
    expect(
      byId(
        analyzeSecurity({ response: withHeaders({ "x-frame-options": "MAYBE" }) }),
        "security.frame_protection.invalid",
      )?.status,
    ).toBe("warn");
  });
});

describe("X-Content-Type-Options and Referrer-Policy", () => {
  it("fails when nosniff is absent", () => {
    expect(
      byId(
        analyzeSecurity({ response: withHeaders({}) }),
        "security.content_type_options.absent",
      )?.status,
    ).toBe("fail");
  });

  it("warns when nosniff has the wrong value", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({ "x-content-type-options": "sniff" }),
        }),
        "security.content_type_options.invalid",
      )?.status,
    ).toBe("warn");
  });

  it("warns when no referrer policy is declared", () => {
    expect(
      byId(
        analyzeSecurity({ response: withHeaders({}) }),
        "security.referrer_policy.absent",
      )?.status,
    ).toBe("warn");
  });

  it("warns about a policy that leaks the full URL", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({ "referrer-policy": "unsafe-url" }),
        }),
        "security.referrer_policy.permissive",
      )?.status,
    ).toBe("warn");
  });

  it("reads the last token of a policy list, as browsers do", () => {
    expect(
      byId(
        analyzeSecurity({
          response: withHeaders({
            "referrer-policy": "no-referrer, strict-origin-when-cross-origin",
          }),
        }),
        "security.referrer_policy.ok",
      )?.status,
    ).toBe("pass");
  });
});

describe("cookies", () => {
  it("passes when there are none, without implying anything about later ones", () => {
    const finding = byId(analyzeSecurity({ response: GOOD }), "security.cookies.none");

    expect(finding?.status).toBe("pass");
    expect(finding?.explanation).toContain("not visible here");
  });

  it("fails a cookie with no Secure attribute on HTTPS", () => {
    expect(
      byId(
        analyzeSecurity({
          response: response({ setCookie: ["sid=abc; HttpOnly; SameSite=Lax"] }),
        }),
        "security.cookies.missing_secure",
      )?.severity,
    ).toBe("serious");
  });

  it("fails SameSite=None without Secure, which browsers reject outright", () => {
    const finding = byId(
      analyzeSecurity({
        response: response({ setCookie: ["sid=abc; HttpOnly; SameSite=None"] }),
      }),
      "security.cookies.samesite_none_insecure",
    );

    expect(finding?.status).toBe("fail");
    expect(finding?.severity).toBe("serious");
  });

  it("warns about a missing HttpOnly without calling it wrong", () => {
    const finding = byId(
      analyzeSecurity({
        response: response({ setCookie: ["theme=dark; Secure; SameSite=Lax"] }),
      }),
      "security.cookies.missing_httponly",
    );

    expect(finding?.status).toBe("warn");
    expect(finding?.explanation).toContain("deliberately");
  });

  it("warns about a missing SameSite", () => {
    expect(
      byId(
        analyzeSecurity({
          response: response({ setCookie: ["sid=abc; Secure; HttpOnly"] }),
        }),
        "security.cookies.missing_samesite",
      )?.status,
    ).toBe("warn");
  });

  it("passes when every attribute is declared", () => {
    expect(
      byId(
        analyzeSecurity({
          response: response({
            setCookie: ["sid=abc; Secure; HttpOnly; SameSite=Lax"],
          }),
        }),
        "security.cookies.ok",
      )?.status,
    ).toBe("pass");
  });

  it("reports several cookie problems separately", () => {
    const findings = analyzeSecurity({
      response: response({ setCookie: ["a=1", "b=2"] }),
    });

    expect(ids(findings)).toEqual(
      expect.arrayContaining([
        "security.cookies.missing_secure",
        "security.cookies.missing_httponly",
        "security.cookies.missing_samesite",
      ]),
    );
  });

  it("never puts a cookie value in the report", () => {
    // The value is frequently a live session token, and this report flows into
    // logs, an API response and eventually an AI prompt.
    const secret = "SUPERSECRETSESSIONVALUE";
    const findings = analyzeSecurity({
      response: response({
        setCookie: [`sid=${secret}; Path=/`, `csrf=${secret}2; Secure`],
      }),
    });

    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it("still names the cookies, so a finding is actionable", () => {
    const findings = analyzeSecurity({
      response: response({ setCookie: ["sid=abc; Path=/"] }),
    });

    expect(JSON.stringify(findings)).toContain("sid");
  });
});

describe("server disclosure", () => {
  it("warns about a version in the Server header", () => {
    expect(
      byId(
        analyzeSecurity({ response: withHeaders({ server: "nginx/1.24.0" }) }),
        "security.disclosure.server_version",
      )?.status,
    ).toBe("warn");
  });

  it("does not report a product name with no version", () => {
    expect(
      byId(
        analyzeSecurity({ response: withHeaders({ server: "nginx" }) }),
        "security.disclosure.server_version",
      ),
    ).toBeUndefined();
  });

  it("warns about technology headers", () => {
    const finding = byId(
      analyzeSecurity({ response: withHeaders({ "x-powered-by": "Express" }) }),
      "security.disclosure.technology_headers",
    );

    expect(finding?.status).toBe("warn");
    expect(finding?.severity).toBe("minor");
  });

  it("keeps disclosure minor, because it is not itself a weakness", () => {
    const findings = analyzeSecurity({
      response: withHeaders({ server: "Apache/2.4.41", "x-powered-by": "PHP/8.1" }),
    });

    const disclosure = findings.filter((finding) =>
      finding.id.startsWith("security.disclosure."),
    );

    expect(disclosure.every((finding) => finding.severity === "minor")).toBe(true);
  });

  it("passes when nothing is disclosed", () => {
    expect(
      byId(analyzeSecurity({ response: withHeaders({}) }), "security.disclosure.minimal")
        ?.status,
    ).toBe("pass");
  });
});

describe("every finding, on every path", () => {
  const scenarios: Array<[string, HttpResponseData]> = [
    ["fully configured", GOOD],
    ["nothing configured", withHeaders({})],
    ["plain HTTP", response({ finalUrl: "http://example.com/", headers: {} })],
    [
      "report-only CSP",
      withHeaders({ "content-security-policy-report-only": "default-src 'self'" }),
    ],
    [
      "unsafe CSP",
      withHeaders({ "content-security-policy": "script-src 'unsafe-inline'" }),
    ],
    [
      "CSP without script rules",
      withHeaders({ "content-security-policy": "img-src 'self'" }),
    ],
    ["legacy frame header", withHeaders({ "x-frame-options": "DENY" })],
    [
      "deprecated frame header",
      withHeaders({ "x-frame-options": "ALLOW-FROM https://a.example" }),
    ],
    ["invalid frame header", withHeaders({ "x-frame-options": "NOPE" })],
    ["invalid nosniff", withHeaders({ "x-content-type-options": "sniff" })],
    ["permissive referrer policy", withHeaders({ "referrer-policy": "unsafe-url" })],
    ["zero max-age", withHeaders({ "strict-transport-security": "max-age=0" })],
    ["short max-age", withHeaders({ "strict-transport-security": "max-age=60" })],
    ["no max-age", withHeaders({ "strict-transport-security": "preload" })],
    [
      "hsts without subdomains",
      withHeaders({ "strict-transport-security": `max-age=${HSTS_MIN_MAX_AGE_SECONDS}` }),
    ],
    ["weak cookies", response({ setCookie: ["a=1"] })],
    ["samesite none cookie", response({ setCookie: ["a=1; SameSite=None"] })],
    ["good cookies", response({ setCookie: ["a=1; Secure; HttpOnly; SameSite=Strict"] })],
    [
      "disclosing server",
      withHeaders({ server: "nginx/1.24.0", "x-powered-by": "Express" }),
    ],
  ];

  it.each(scenarios)(
    "gives every finding evidence and a recommendation for %s",
    (_label, target) => {
      const findings = analyzeSecurity({ response: target });

      expect(findings.length).toBeGreaterThan(0);

      for (const finding of findings) {
        expect(finding.evidence.length, `${finding.id} has no evidence`).toBeGreaterThan(
          0,
        );
        expect(
          (finding.recommendation ?? "").length,
          `${finding.id} has no recommendation`,
        ).toBeGreaterThan(0);
        expect(finding.category).toBe("security");
      }
    },
  );

  it("actually reaches every finding the checks can emit", () => {
    const seen = new Set(
      scenarios.flatMap(([, target]) => ids(analyzeSecurity({ response: target }))),
    );

    const expected = [
      "security.https.absent",
      "security.https.present",
      "security.hsts.not_applicable",
      "security.hsts.absent",
      "security.hsts.no_max_age",
      "security.hsts.disabled",
      "security.hsts.short_max_age",
      "security.hsts.no_subdomains",
      "security.hsts.ok",
      "security.csp.absent",
      "security.csp.report_only",
      "security.csp.unsafe_script_sources",
      "security.csp.no_script_restriction",
      "security.csp.present",
      "security.frame_protection.absent",
      "security.frame_protection.csp",
      "security.frame_protection.legacy",
      "security.frame_protection.deprecated",
      "security.frame_protection.invalid",
      "security.content_type_options.absent",
      "security.content_type_options.invalid",
      "security.content_type_options.ok",
      "security.referrer_policy.absent",
      "security.referrer_policy.permissive",
      "security.referrer_policy.ok",
      "security.cookies.none",
      "security.cookies.missing_secure",
      "security.cookies.missing_httponly",
      "security.cookies.missing_samesite",
      "security.cookies.samesite_none_insecure",
      "security.cookies.ok",
      "security.disclosure.server_version",
      "security.disclosure.technology_headers",
      "security.disclosure.minimal",
    ];

    expect(expected.filter((id) => !seen.has(id))).toEqual([]);
  });
});
