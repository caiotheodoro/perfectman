import { config as loadDotenv } from "dotenv";
import { findUp } from "../config/simulation-config.js";

type LoadDotenv = typeof loadDotenv;

export function loadEnvFile(
  startDir = process.cwd(),
  load: LoadDotenv = loadDotenv,
): void {
  const envPath = findUp(".env", startDir);
  if (!envPath) return;

  load({ path: envPath, quiet: true });
}
