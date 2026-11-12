const PII_RULES = [
  { name: "手机号", re: /1[3-9]\d{9}/g, to: "[手机号]" },
  { name: "身份证", re: /\d{17}[\dXx]/g, to: "[身份证]" },
  { name: "学号", re: /\b(20\d{2})\d{6,10}\b/g, to: "[学号]" },
  { name: "邮箱", re: /[\w.+-]+@[\w-]+\.[\w.]+/g, to: "[邮箱]" },
  { name: "座机", re: /\b0\d{2,3}-?\d{7,8}\b/g, to: "[电话]" }
];

function redact(text) {
  let out = String(text || "");
  const hit = [];
  for (const r of PII_RULES) {
    if (out.match(r.re)) hit.push(r.name);
    out = out.replace(r.re, r.to);
  }
  return { text: out, hit };
}

function uniqueHits(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

function redactInput(input = {}) {
  const clean = { ...input };
  const hits = [];
  for (const key of ["sceneName", "situation", "parentReaction", "studentWish", "stage", "extra"]) {
    if (typeof clean[key] === "string") {
      const result = redact(clean[key]);
      clean[key] = result.text;
      hits.push(...result.hit);
    }
  }
  if (Array.isArray(clean.chips)) {
    clean.chips = clean.chips.map(value => {
      const result = redact(value);
      hits.push(...result.hit);
      return result.text;
    });
  }
  return { input: clean, hit: uniqueHits(hits) };
}

const SAFETY_SIGNAL_RE = /(自杀|自伤|轻生|伤害自己|不想活|结束生命|自残)/;

module.exports = { redactInput, SAFETY_SIGNAL_RE };
