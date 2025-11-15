// Small utility helpers
function safeNum(value, fallback = 0) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : fallback);
}

module.exports = { safeNum };
