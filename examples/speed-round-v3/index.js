#!/usr/bin/env node
import { getRandomTip } from "./tips.js";

function main() {
  const tip = getRandomTip();
  console.log(`Tip of the Day:\n${tip}`);
}

main();
