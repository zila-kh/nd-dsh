#!/usr/bin/env node
/*
 * verify.mjs — dependency-free smoke checks for the counter app (Node built-ins only).
 * Run: node verify.mjs
 * Exits non-zero if any check fails.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (name) => {
  const p = join(root, name);
  if (!existsSync(p)) throw new Error(`missing file: ${name}`);
  return readFileSync(p, "utf8");
};

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

let html, css, js;
try {
  html = read("index.html");
  css = read("styles.css");
  js = read("app.js");
} catch (err) {
  console.error(`FAIL ${err.message}`);
  process.exit(1);
}

/* --- index.html --- */
check("doctype present", /^<!DOCTYPE html>/i.test(html.trim()));
check("lang=\"en\" attribute", /<html[^>]*\blang=["']en["']/.test(html));
check("viewport meta", /name=["']viewport["']/.test(html));
check("links styles.css", /<link[^>]+href=["']styles\.css["']/i.test(html));
check("loads app.js", /<script[^>]+src=["']app\.js["']/i.test(html));
check(
  "three traffic-light controls",
  ["light-close", "light-minimize", "light-zoom"].every((c) => html.includes(c))
);
check(
  "count output with aria-live",
  /<output[^>]*id=["']count["'][^>]*aria-live=["']polite["']/.test(html)
);
check("decrement button labelled", /<button[^>]*id=["']decrement["'][^>]*aria-label=/.test(html));
check("reset button labelled", /<button[^>]*id=["']reset["'][^>]*aria-label=/.test(html));
check("increment button labelled", /<button[^>]*id=["']increment["'][^>]*aria-label=/.test(html));

/* --- styles.css --- */
check("frosted glass (backdrop-filter)", /backdrop-filter\s*:\s*blur\(/.test(css));
check("frosted glass (-webkit- prefix)", /-webkit-backdrop-filter\s*:\s*blur\(/.test(css));
check(
  "traffic-light colors",
  ["#ff5f57", "#febc2e", "#28c840"].every((c) => css.includes(c))
);
check(
  "SF-style system font stack",
  css.includes("-apple-system") && css.includes("BlinkMacSystemFont")
);
check("tabular numerals", css.includes("tabular-nums"));
check("keyboard focus-visible styles", css.includes(":focus-visible"));
check("reduced-motion support", /prefers-reduced-motion\s*:\s*reduce/.test(css));
check("responsive breakpoint", /@media[^{]*max-width/.test(css));

/* --- app.js --- */
check("strict mode", js.includes("\"use strict\""));
check("ArrowUp handler", js.includes("\"ArrowUp\""));
check("ArrowDown handler", js.includes("\"ArrowDown\""));
check("R reset shortcut (both cases)", js.includes("\"r\"") && js.includes("\"R\""));
check(
  "increment/decrement/reset logic",
  ["function increment", "function decrement", "function reset"].every((fn) => js.includes(fn))
);
check(
  "event listeners attached",
  (js.match(/addEventListener/g) || []).length >= 4
);

/* --- dependency-free --- */
const external = (html + css + js).match(/https?:\/\//g) || [];
check("no external network references", external.length === 0, external.join(","));

/* --- report --- */
let failed = 0;
for (const c of checks) {
  if (c.ok) {
    console.log(`PASS  ${c.name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
