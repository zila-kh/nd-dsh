export const TIPS = [
  "Use node --test for zero-dependency native test running in Node.js.",
  "Keep functions small and focused on single responsibility.",
  "Use structured logging to make CLI output parseable.",
  "Validate input edge cases early before executing core logic.",
  "Prefer standard built-in modules over third-party dependencies when possible.",
  "Use async/await with clean error handling for asynchronous code."
];

export function getRandomTip(tips = TIPS, random = Math.random) {
  if (!tips || tips.length === 0) {
    throw new Error("Tips list cannot be empty");
  }
  const index = Math.floor(random() * tips.length);
  return tips[index];
}
