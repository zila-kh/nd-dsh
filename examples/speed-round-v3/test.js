import test from "node:test";
import assert from "node:assert/strict";
import { TIPS, getRandomTip } from "./tips.js";

test("TIPS list is non-empty array of strings", () => {
  assert.ok(Array.isArray(TIPS));
  assert.ok(TIPS.length > 0);
  for (const tip of TIPS) {
    assert.equal(typeof tip, "string");
    assert.ok(tip.length > 0);
  }
});

test("getRandomTip returns item from tips list", () => {
  const tip = getRandomTip(TIPS, () => 0);
  assert.equal(tip, TIPS[0]);

  const lastTip = getRandomTip(TIPS, () => 0.999);
  assert.equal(lastTip, TIPS[TIPS.length - 1]);
});

test("getRandomTip throws on empty or missing tips list", () => {
  assert.throws(() => getRandomTip([]), {
    message: "Tips list cannot be empty"
  });
  assert.throws(() => getRandomTip(null), {
    message: "Tips list cannot be empty"
  });
});
