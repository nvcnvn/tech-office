#!/usr/bin/env node
/**
 * Guard against the Expo Router route-hijack that sent notification taps to "Task not found".
 *
 * Expo Router compiles a group segment in a route pattern to an *optional* regex group and
 * ranks candidate routes by (static segment count, then segment count). So a route whose
 * pattern is nothing but dynamic segments outranks a shorter all-dynamic route and swallows
 * the literal group token in its href: `(app)/(tasks)/[projectId]/[taskId]` matched
 * `/(app)/(chat)/<channelId>` as `{projectId: "(chat)", taskId: "<channelId>"}`.
 *
 * The invariant that prevents it: every all-dynamic route must have the same segment count.
 * Give the longer one a static segment (that is why the task screen lives at
 * `[projectId]/task/[taskId]`).
 *
 *   node scripts/check-route-ambiguity.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

const isGroup = (s) => s.startsWith("(") && s.endsWith(")");
const isDynamic = (s) => s.startsWith("[") && s.endsWith("]");

function routes(dir, base = []) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = [...base, entry.name.replace(/\.[jt]sx?$/, "")];
    if (entry.isDirectory()) return routes(path.join(dir, entry.name), next);
    if (!/\.[jt]sx?$/.test(entry.name)) return [];
    const leaf = next[next.length - 1];
    if (leaf === "_layout" || leaf.startsWith("+")) return [];
    return [{ file: next.join("/"), segments: leaf === "index" ? next.slice(0, -1) : next }];
  });
}

// Groups are optional at match time, so they are not part of what a route competes on.
const allDynamic = routes(APP_DIR)
  .map((route) => ({ ...route, parts: route.segments.filter((s) => !isGroup(s)) }))
  .filter((route) => route.parts.length > 0 && route.parts.every(isDynamic))
  .filter((route) => !route.parts.some((s) => s.startsWith("[..."))); // the catch-all is a deliberate fallback

const lengths = [...new Set(allDynamic.map((route) => route.parts.length))].sort();

if (lengths.length > 1) {
  const longest = Math.max(...lengths);
  const hijackers = allDynamic.filter((r) => r.parts.length === longest);
  const victims = allDynamic.filter((r) => r.parts.length < longest);
  console.error(
    `Ambiguous routes — these will swallow the group token of shorter all-dynamic routes:\n` +
      hijackers.map((r) => `  ${r.file}`).join("\n") +
      `\nhijacking:\n` +
      victims.map((r) => `  ${r.file}`).join("\n") +
      `\n\nAdd a static segment to the longer route, e.g. [projectId]/task/[taskId].`,
  );
  process.exit(1);
}

console.log(`OK — ${allDynamic.length} all-dynamic routes, all ${lengths[0] ?? 0} segment(s) deep.`);
