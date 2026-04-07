import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

function runCli(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`bun run src/cli.ts ${args}`, {
      cwd: "/tmp/loom-e2e-pass2",
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe("CLI", () => {
  it("adds two numbers", () => {
    const result = runCli("2 add 3");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("5");
  });

  it("subtracts two numbers", () => {
    const result = runCli("10 subtract 4");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("6");
  });

  it("multiplies two numbers", () => {
    const result = runCli("5 multiply 6");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("30");
  });

  it("divides two numbers", () => {
    const result = runCli("20 divide 4");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("5");
  });

  it("handles division by zero with error", () => {
    const result = runCli("10 divide 0");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/division by zero/i);
  });

  it("prints help with --help flag", () => {
    const result = runCli("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/add/);
    expect(result.stdout).toMatch(/subtract/);
    expect(result.stdout).toMatch(/multiply/);
    expect(result.stdout).toMatch(/divide/);
  });

  it("errors on invalid number input", () => {
    const result = runCli("foo add 3");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/invalid number/i);
  });

  it("errors on invalid operator", () => {
    const result = runCli("5 modulo 3");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/invalid operator/i);
  });
});
