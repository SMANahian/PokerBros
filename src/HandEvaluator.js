'use strict';

const HAND_NAMES = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush',
];

function getCombinations(arr, r) {
  if (r === 0) return [[]];
  if (arr.length < r) return [];
  const [first, ...rest] = arr;
  return [
    ...getCombinations(rest, r - 1).map(c => [first, ...c]),
    ...getCombinations(rest, r),
  ];
}

function evaluateFive(cards) {
  const vals = cards.map(c => c.value).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  let isStraight = false;
  let straightHigh = vals[0];
  if (new Set(vals).size === 5) {
    if (vals[0] - vals[4] === 4) {
      isStraight = true;
      straightHigh = vals[0];
    }
    // Wheel: A-2-3-4-5
    if (vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  const freq = {};
  for (const v of vals) freq[v] = (freq[v] || 0) + 1;
  const groups = Object.entries(freq)
    .map(([v, c]) => [parseInt(v), c])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const counts = groups.map(g => g[1]);
  const gVals = groups.map(g => g[0]);

  if (isFlush && isStraight) {
    const rank = straightHigh === 14 ? 9 : 8;
    return { rank, name: HAND_NAMES[rank], tiebreaker: [straightHigh] };
  }
  if (counts[0] === 4) return { rank: 7, name: HAND_NAMES[7], tiebreaker: [gVals[0], gVals[1]] };
  if (counts[0] === 3 && counts[1] === 2) return { rank: 6, name: HAND_NAMES[6], tiebreaker: [gVals[0], gVals[1]] };
  if (isFlush) return { rank: 5, name: HAND_NAMES[5], tiebreaker: vals };
  if (isStraight) return { rank: 4, name: HAND_NAMES[4], tiebreaker: [straightHigh] };
  if (counts[0] === 3) return { rank: 3, name: HAND_NAMES[3], tiebreaker: [gVals[0], gVals[1], gVals[2]] };
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = [gVals[0], gVals[1]].sort((a, b) => b - a);
    return { rank: 2, name: HAND_NAMES[2], tiebreaker: [pairs[0], pairs[1], gVals[2]] };
  }
  if (counts[0] === 2) return { rank: 1, name: HAND_NAMES[1], tiebreaker: [gVals[0], gVals[1], gVals[2], gVals[3]] };
  return { rank: 0, name: HAND_NAMES[0], tiebreaker: vals };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.tiebreaker.length, b.tiebreaker.length); i++) {
    if (a.tiebreaker[i] !== b.tiebreaker[i]) return a.tiebreaker[i] - b.tiebreaker[i];
  }
  return 0;
}

function bestHand(holeCards, communityCards) {
  const all = [...holeCards, ...communityCards];
  if (all.length < 5) {
    const result = all.length >= 2 ? evaluateFive(all.concat(Array(5 - all.length).fill({ value: 0, suit: 'x' }))) : { rank: 0, name: 'High Card', tiebreaker: [] };
    return { ...result, bestCards: all };
  }
  const combos = getCombinations(all, 5);
  let best = null;
  let bestCards = null;
  for (const combo of combos) {
    const h = evaluateFive(combo);
    if (!best || compareHands(h, best) > 0) {
      best = h;
      bestCards = combo;
    }
  }
  return { ...best, bestCards };
}

module.exports = { bestHand, compareHands, evaluateFive, HAND_NAMES };
