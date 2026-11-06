#!/usr/bin/env node
import { spawnSync } from "node:child_process";

/**
 * Vercel Build Mode Dispatcher
 *
 * Automatically dispatches the build command based on VERCEL_ENV:
 * - Vercel Preview (VERCEL_ENV === "preview"): executes `npm run build:staging`
 * - Vercel Production (VERCEL_ENV === "production" or default): executes `npm run build:production`
 *
 * This ensures that preview deployments targeting staging build with `--mode staging`
 * while production deployments build with `--mode production`.
 */

const vercelEnv = process.env.VERCEL_ENV;
const isPreview = vercelEnv === "preview";
const targetScript = isPreview ? "build:staging" : "build:production";
const targetMode = isPreview ? "staging" : "production";

console.log(
  `[Vercel Build Dispatcher] VERCEL_ENV='${vercelEnv ?? "undefined"}' -> Dispatching to '${targetScript}' (Vite mode: ${targetMode})`
);

const result = spawnSync("npm", ["run", targetScript], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (result.error) {
  console.error(`[Vercel Build Dispatcher] Failed to execute ${targetScript}:`, result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
