/**
 * Tests for the context-monitor hook: configurable warning thresholds,
 * debounce behavior, severity escalation, and status.toon writing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Replicate the monitor's internal logic for unit testing.
// The hook itself runs via stdin/runHook and calls process.exit, so we
// extract and test the core algorithms in isolation.
// ---------------------------------------------------------------------------

interface MonitorConfig {
  contextWindow: number;
  checkpointWarning: number;
  checkpointCritical: number;
}

interface MonitorState {
  toolUseCount: number;
  lastWarnAt: number;
  lastSeverity: string;
}

/** Mirror of readMonitorConfig from context-monitor.ts */
function readMonitorConfig(cwd?: string): MonitorConfig {
  const defaults: MonitorConfig = {
    contextWindow: 200000,
    checkpointWarning: 0.35,
    checkpointCritical: 0.25,
  };

  try {
    const tomlPath = cwd
      ? path.join(cwd, ".claude", "orchestration.toml")
      : path.resolve(".claude", "orchestration.toml");
    if (!fs.existsSync(tomlPath)) return defaults;
    const content = fs.readFileSync(tomlPath, "utf-8");
    if (!content.includes("[settings.contextBudget]")) return defaults;
    const sectionMatch = content.match(
      /\[settings\.contextBudget\]([\s\S]*?)(?=\n\s*\[|\s*$)/
    );
    if (!sectionMatch) return defaults;
    const section = sectionMatch[1];
    const windowMatch = section.match(/contextWindow\s*=\s*(\d+)/);
    const warningMatch = section.match(/checkpointWarning\s*=\s*([\d.]+)/);
    const criticalMatch = section.match(/checkpointCritical\s*=\s*([\d.]+)/);
    return {
      contextWindow: windowMatch ? parseInt(windowMatch[1], 10) : defaults.contextWindow,
      checkpointWarning: warningMatch ? parseFloat(warningMatch[1]) : defaults.checkpointWarning,
      checkpointCritical: criticalMatch ? parseFloat(criticalMatch[1]) : defaults.checkpointCritical,
    };
  } catch {
    return defaults;
  }
}

/** Determine severity level from remaining fraction. */
function classifySeverity(
  remainingFraction: number,
  config: MonitorConfig
): "none" | "warning" | "critical" {
  if (remainingFraction <= config.checkpointCritical) return "critical";
  if (remainingFraction <= config.checkpointWarning) return "warning";
  return "none";
}

/** Debounce logic mirroring context-monitor.ts */
function shouldEmitWarning(
  state: MonitorState,
  currentSeverity: string
): boolean {
  if (currentSeverity === "none") return false;
  const sinceLastWarn = state.toolUseCount - state.lastWarnAt;
  const severityEscalated =
    currentSeverity === "critical" && state.lastSeverity !== "critical";
  return sinceLastWarn >= 5 || severityEscalated;
}

// ---------------------------------------------------------------------------
// 1. Configurable warning thresholds (AC #4)
// ---------------------------------------------------------------------------

describe("configurable warning thresholds", () => {
  it("uses default thresholds: 35% warning, 25% critical", () => {
    const config = readMonitorConfig("/nonexistent");
    expect(config.checkpointWarning).toBe(0.35);
    expect(config.checkpointCritical).toBe(0.25);
    expect(config.contextWindow).toBe(200000);
  });

  it("reads custom thresholds from orchestration.toml", () => {
    const tmpDir = path.join("/tmp", "loom-test-monitor-thresholds-" + process.pid);
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "orchestration.toml"),
      [
        "[settings.contextBudget]",
        "contextWindow = 1000000",
        "checkpointWarning = 0.40",
        "checkpointCritical = 0.30",
      ].join("\n")
    );

    try {
      const config = readMonitorConfig(tmpDir);
      expect(config.contextWindow).toBe(1000000);
      expect(config.checkpointWarning).toBe(0.4);
      expect(config.checkpointCritical).toBe(0.3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("with default 200k window: 35% remaining = 70k tokens triggers warning", () => {
    const config: MonitorConfig = {
      contextWindow: 200000,
      checkpointWarning: 0.35,
      checkpointCritical: 0.25,
    };
    // 70k remaining out of 200k = 0.35 fraction
    const remaining = 70000;
    const fraction = remaining / config.contextWindow;
    expect(fraction).toBe(0.35);
    expect(classifySeverity(fraction, config)).toBe("warning");
  });

  it("with default 200k window: 25% remaining = 50k tokens triggers critical", () => {
    const config: MonitorConfig = {
      contextWindow: 200000,
      checkpointWarning: 0.35,
      checkpointCritical: 0.25,
    };
    const remaining = 50000;
    const fraction = remaining / config.contextWindow;
    expect(fraction).toBe(0.25);
    expect(classifySeverity(fraction, config)).toBe("critical");
  });

  it("with 1M window: 350k remaining triggers warning", () => {
    const config: MonitorConfig = {
      contextWindow: 1000000,
      checkpointWarning: 0.35,
      checkpointCritical: 0.25,
    };
    const remaining = 350000;
    const fraction = remaining / config.contextWindow;
    expect(fraction).toBe(0.35);
    expect(classifySeverity(fraction, config)).toBe("warning");
  });

  it("with 1M window: 250k remaining triggers critical", () => {
    const config: MonitorConfig = {
      contextWindow: 1000000,
      checkpointWarning: 0.35,
      checkpointCritical: 0.25,
    };
    const remaining = 250000;
    const fraction = remaining / config.contextWindow;
    expect(fraction).toBe(0.25);
    expect(classifySeverity(fraction, config)).toBe("critical");
  });

  it("above warning threshold classifies as 'none'", () => {
    const config: MonitorConfig = {
      contextWindow: 200000,
      checkpointWarning: 0.35,
      checkpointCritical: 0.25,
    };
    expect(classifySeverity(0.50, config)).toBe("none");
    expect(classifySeverity(0.36, config)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// 2. Debounce behavior (AC #5)
// ---------------------------------------------------------------------------

describe("debounce behavior", () => {
  it("warns every 5 tool uses when in warning zone", () => {
    const state: MonitorState = {
      toolUseCount: 10,
      lastWarnAt: 5,
      lastSeverity: "warning",
    };
    // 10 - 5 = 5 tool uses since last warn => should warn
    expect(shouldEmitWarning(state, "warning")).toBe(true);
  });

  it("suppresses warning before 5 tool uses have elapsed", () => {
    const state: MonitorState = {
      toolUseCount: 8,
      lastWarnAt: 5,
      lastSeverity: "warning",
    };
    // 8 - 5 = 3 tool uses since last warn => suppress
    expect(shouldEmitWarning(state, "warning")).toBe(false);
  });

  it("severity escalation (warning -> critical) bypasses debounce", () => {
    const state: MonitorState = {
      toolUseCount: 7,
      lastWarnAt: 5,
      lastSeverity: "warning", // was warning, now critical
    };
    // Only 2 tool uses since last warn, but severity escalated
    expect(shouldEmitWarning(state, "critical")).toBe(true);
  });

  it("does not bypass debounce when severity stays at critical", () => {
    const state: MonitorState = {
      toolUseCount: 7,
      lastWarnAt: 5,
      lastSeverity: "critical", // was already critical
    };
    // 7 - 5 = 2 tool uses, no escalation
    expect(shouldEmitWarning(state, "critical")).toBe(false);
  });

  it("does not warn when severity is 'none'", () => {
    const state: MonitorState = {
      toolUseCount: 100,
      lastWarnAt: 0,
      lastSeverity: "none",
    };
    expect(shouldEmitWarning(state, "none")).toBe(false);
  });

  it("warns at exactly 5 tool uses after last warning", () => {
    const state: MonitorState = {
      toolUseCount: 15,
      lastWarnAt: 10,
      lastSeverity: "warning",
    };
    expect(shouldEmitWarning(state, "warning")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Status.toon writing (context monitor writes contextRemaining)
// ---------------------------------------------------------------------------

describe("status.toon writing", () => {
  const tmpDir = path.join("/tmp", "loom-test-status-" + process.pid);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Mirror of writeContextRemainingToStatus from context-monitor.ts */
  function writeContextRemainingToStatus(
    planExecDir: string,
    remainingPct: number,
    isCritical: boolean
  ): void {
    try {
      const statusPath = path.join(planExecDir, "status.toon");
      let content = "";
      try {
        content = fs.readFileSync(statusPath, "utf-8");
      } catch {
        return; // only update if status.toon already exists
      }
      const lines = content
        .split("\n")
        .filter(
          (l) =>
            !l.startsWith("contextRemaining:") &&
            !l.startsWith("contextCritical:")
        );
      lines.push(`contextRemaining: ${remainingPct}`);
      if (isCritical) {
        lines.push(`contextCritical: true`);
      }
      const updated = lines.join("\n");
      const tmpPath = statusPath + ".tmp";
      fs.writeFileSync(tmpPath, updated);
      fs.renameSync(tmpPath, statusPath);
    } catch {
      // fail open
    }
  }

  it("updates contextRemaining in an existing status.toon", () => {
    const statusPath = path.join(tmpDir, "status.toon");
    fs.writeFileSync(statusPath, "stage: execute\nwave: 2\n");

    writeContextRemainingToStatus(tmpDir, 65, false);

    const content = fs.readFileSync(statusPath, "utf-8");
    expect(content).toContain("contextRemaining: 65");
    expect(content).not.toContain("contextCritical:");
    expect(content).toContain("stage: execute");
  });

  it("adds contextCritical: true when critical", () => {
    const statusPath = path.join(tmpDir, "status.toon");
    fs.writeFileSync(statusPath, "stage: converge\n");

    writeContextRemainingToStatus(tmpDir, 20, true);

    const content = fs.readFileSync(statusPath, "utf-8");
    expect(content).toContain("contextRemaining: 20");
    expect(content).toContain("contextCritical: true");
  });

  it("replaces existing contextRemaining on subsequent writes", () => {
    const statusPath = path.join(tmpDir, "status.toon");
    fs.writeFileSync(statusPath, "stage: execute\ncontextRemaining: 80\n");

    writeContextRemainingToStatus(tmpDir, 45, false);

    const content = fs.readFileSync(statusPath, "utf-8");
    const matches = content.match(/contextRemaining:/g);
    expect(matches).toHaveLength(1);
    expect(content).toContain("contextRemaining: 45");
  });

  it("does not create status.toon if it does not already exist", () => {
    writeContextRemainingToStatus(tmpDir, 50, false);
    expect(fs.existsSync(path.join(tmpDir, "status.toon"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Monitor state persistence (JSON state file)
// ---------------------------------------------------------------------------

describe("monitor state persistence", () => {
  const stateFile = path.join("/tmp", "loom-test-monitor-state-" + process.pid + ".json");

  afterEach(() => {
    try { fs.unlinkSync(stateFile); } catch { /* noop */ }
  });

  function readMonitorState(): MonitorState {
    try {
      const raw = fs.readFileSync(stateFile, "utf-8");
      return JSON.parse(raw);
    } catch {
      return { toolUseCount: 0, lastWarnAt: 0, lastSeverity: "none" };
    }
  }

  function writeMonitorState(state: MonitorState): void {
    fs.writeFileSync(stateFile, JSON.stringify(state));
  }

  it("returns default state when file does not exist", () => {
    const state = readMonitorState();
    expect(state.toolUseCount).toBe(0);
    expect(state.lastWarnAt).toBe(0);
    expect(state.lastSeverity).toBe("none");
  });

  it("persists and reads back state correctly", () => {
    const written: MonitorState = {
      toolUseCount: 42,
      lastWarnAt: 40,
      lastSeverity: "warning",
    };
    writeMonitorState(written);
    const read = readMonitorState();
    expect(read).toEqual(written);
  });
});
