// Structured runtime diagnostics for room and service-level failures.
// The goal is to keep failures explainable without hiding them behind a
// generic console message or a silent no-op.

// `level` is "warn" by default and "error" for what used to be a console.error,
// so moving a message through here never lowers how loudly it is logged.
export function reportRuntimeIssue(scope, message, details = {}, level = "warn") {
  const entry = {
    scope,
    message,
    details,
    level,
    timestamp: new Date().toISOString(),
  };

  const log = level === "error" ? console.error : console.warn;
  if (Object.keys(details).length) {
    log(`[${scope}] ${message}`, details);
  } else {
    log(`[${scope}] ${message}`);
  }

  return entry;
}

export function snapshotRuntime(scope, extra = {}) {
  return {
    scope,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}
