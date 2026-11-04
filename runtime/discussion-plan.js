import { boundedCount } from "./reply-motion.js";

export function discussionPlan({ discussion = false, rounds = 1, participants = 1 } = {}) {
  const total = discussion ? boundedCount(rounds) : 1;
  const count = Math.min(3, boundedCount(participants));
  return Array.from({ length: total * count }, (_, index) => ({
    round: Math.floor(index / count), turn: index % count,
    rounds: total, count, closing: index === total * count - 1,
  }));
}
