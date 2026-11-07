/**
 * hotel — the Phase 3 evaluation layer for the hotel integration.
 *
 *   pnpm --filter @perfectman/eval hotel                         mock canaries + broken-stub self-test (CI)
 *   pnpm --filter @perfectman/eval hotel --mode local            also run the real actor (OPENROUTER_API_KEY)
 *   pnpm --filter @perfectman/eval hotel --run <run-dir>         deterministic checks on a recorded run
 *   pnpm --filter @perfectman/eval hotel --run <dir> --judge llm judge the recorded run
 *   pnpm --filter @perfectman/eval hotel --calibrate [--judge llm]  kappa of the judge vs the labeled snippets
 *
 * `bench --suite hotel ...` forwards here. Exit code 1 when any deterministic check fails.
 */
import { runHotelSuite } from "../hotel/suite.js";

export async function runHotelCli(args: string[]): Promise<void> {
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const mode = value("--mode");
  if (mode !== undefined && mode !== "mock" && mode !== "local") {
    console.error(`unknown --mode ${mode} (expected mock|local)`);
    process.exit(2);
  }
  const judge = value("--judge");
  if (judge !== undefined && judge !== "off" && judge !== "rule" && judge !== "llm") {
    console.error(`unknown --judge ${judge} (expected off|rule|llm)`);
    process.exit(2);
  }
  const report = await runHotelSuite({
    mode: mode as "mock" | "local" | undefined,
    run: value("--run"),
    judge: judge as "off" | "rule" | "llm" | undefined,
    calibrate: args.includes("--calibrate"),
    out: value("--out"),
  });
  if (!report.ok) process.exit(1);
}

if (process.argv[1]?.endsWith("hotel.js") || process.argv[1]?.endsWith("hotel.ts")) {
  runHotelCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
