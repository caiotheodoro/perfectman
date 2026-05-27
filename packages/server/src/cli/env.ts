import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { config as loadDotenv } from "dotenv";

type LoadDotenv = typeof loadDotenv;

export function loadEnvFile(
  startDir = process.cwd(),
  load: LoadDotenv = loadDotenv,
): void {
  const envPath = findUp(".env", startDir);
  if (!envPath) return;

  load({ path: envPath, quiet: true });
}

export function findUp(filename: string, startDir: string): string | null {
  let current = startDir;
  const root = parse(current).root;

  while (true) {
    const candidate = join(current, filename);
    if (existsSync(candidate)) return candidate;
    if (current === root) return null;
    current = dirname(current);
  }
}
