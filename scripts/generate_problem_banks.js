const fs = require('fs');
const path = require('path');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function gcd(a, b) {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return Math.abs(a);
}

function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function makeMcq(prompt, correct, wrongs, label, weight) {
  const unique = Array.from(new Set([correct, ...wrongs])).slice(0, 5);
  if (unique.length < 5) {
    return null;
  }
  const choices = shuffle(unique);
  const answerIndex = choices.findIndex((c) => c === correct);
  return {
    type: 'mcq',
    label,
    weight,
    prompt,
    choices,
    answerIndex,
    answerKey: String.fromCharCode(65 + answerIndex),
    answer: correct,
  };
}

function makeInput(prompt, answer, label, weight) {
  return { type: 'input', label, weight, prompt, answer };
}

function countDivisors(n) {
  let x = n;
  let total = 1;
  let p = 2;
  while (p * p <= x) {
    if (x % p === 0) {
      let e = 0;
      while (x % p === 0) {
        x /= p;
        e += 1;
      }
      total *= e + 1;
    }
    p += 1;
  }
  if (x > 1) total *= 2;
  return total;
}

function genAmc8One() {
  const t = randInt(1, 7);
  if (t === 1) {
    const a = randInt(10, 80);
    const b = randInt(5, 40);
    const prompt = `${a} + ${b} = ?`;
    const correct = a + b;
    return makeMcq(prompt, correct, [correct - 1, correct + 1, correct - 2, correct + 2], 'AMC8 Style', randInt(2, 5));
  }
  if (t === 2) {
    const a = randInt(30, 99);
    const b = randInt(5, 29);
    const prompt = `${a} - ${b} = ?`;
    const correct = a - b;
    return makeMcq(prompt, correct, [correct - 3, correct + 3, correct - 1, correct + 1], 'AMC8 Style', randInt(2, 5));
  }
  if (t === 3) {
    const a = randInt(6, 25);
    const b = randInt(4, 18);
    const prompt = `${a} \u00d7 ${b} = ?`;
    const correct = a * b;
    return makeMcq(prompt, correct, [correct + a, correct - b, correct + b, correct - a], 'AMC8 Style', randInt(2, 5));
  }
  if (t === 4) {
    const w = randInt(4, 20);
    const h = randInt(3, 18);
    const prompt = `A rectangle has width ${w} and height ${h}. What is its perimeter?`;
    const correct = 2 * (w + h);
    return makeMcq(prompt, correct, [w + h, w * h, 2 * w + h, w + 2 * h], 'AMC8 Style', randInt(2, 5));
  }
  if (t === 5) {
    const red = randInt(2, 8);
    const blue = randInt(2, 8);
    const total = red + blue;
    const correct = `${red}/${total}`;
    const prompt = `A bag has ${red} red and ${blue} blue marbles. P(red) is:`;
    return makeMcq(prompt, correct, [`${blue}/${total}`, `${red}/${blue}`, `${red}/${blue + 1}`, `${red + 1}/${total}`], 'AMC8 Style', randInt(2, 5));
  }
  if (t === 6) {
    const p = [2, 3, 5, 7][randInt(0, 3)];
    const a = randInt(1, 4);
    const b = randInt(1, 3);
    const q = [11, 13, 17][randInt(0, 2)];
    const n = Math.pow(p, a) * Math.pow(q, b);
    const correct = countDivisors(n);
    const prompt = `How many positive divisors does ${n} have?`;
    return makeMcq(prompt, correct, [correct - 1, correct + 1, correct + 2, correct - 2], 'AMC8 Style', randInt(2, 5));
  }
  const mod = [5, 7, 9, 11][randInt(0, 3)];
  const a = randInt(2, 12);
  const b = randInt(2, 10);
  const correct = (a * a + b * b) % mod;
  const prompt = `What is the remainder when ${a}^2 + ${b}^2 is divided by ${mod}?`;
  return makeMcq(prompt, correct, [(correct + 1) % mod, (correct + 2) % mod, (correct + 3) % mod, (correct + 4) % mod], 'AMC8 Style', randInt(2, 5));
}

function genAmc10One() {
  const t = randInt(1, 6);
  if (t === 1) {
    const r = randInt(3, 20);
    const correct = `${r * r}pi`;
    const prompt = `A circle has radius ${r}. What is its area?`;
    return makeMcq(prompt, correct, [`${2 * r}pi`, `${r}pi`, `${2 * r * r}pi`, `${(r + 1) * (r + 1)}pi`], 'AMC10', 10);
  }
  if (t === 2) {
    const n = randInt(6, 15);
    const correct = (n * (n - 3)) / 2;
    const prompt = `How many diagonals does a ${n}-gon have?`;
    return makeMcq(prompt, correct, [n * (n - 3), (n * (n - 1)) / 2, n * (n - 2) / 2, correct + n], 'AMC10', 10);
  }
  if (t === 3) {
    const a = randInt(2, 8);
    const b = randInt(5, 14);
    const c = randInt(3, 12);
    const x = randInt(2, 10);
    const rhs = a * x + b + c;
    const prompt = `If ${a}x + ${b} = ${rhs - c}, what is x + ${c}?`;
    const correct = x + c;
    return makeMcq(prompt, correct, [x + c + 1, x + c - 1, x + b, x + a], 'AMC10', 10);
  }
  if (t === 4) {
    const m = [7, 9, 11, 13][randInt(0, 3)];
    const base = randInt(2, 9);
    const exp = randInt(5, 20);
    let p = 1;
    for (let i = 0; i < exp; i += 1) p = (p * base) % m;
    const correct = p;
    const prompt = `What is the remainder when ${base}^${exp} is divided by ${m}?`;
    return makeMcq(prompt, correct, [(correct + 1) % m, (correct + 2) % m, (correct + 3) % m, (correct + 4) % m], 'AMC10', 10);
  }
  if (t === 5) {
    const n = randInt(20, 80);
    const a = randInt(2, 8);
    const b = randInt(2, 8);
    const both = Math.floor(n / lcm(a, b));
    const correct = Math.floor(n / a) + Math.floor(n / b) - both;
    const prompt = `How many integers from 1 to ${n} are divisible by ${a} or ${b}?`;
    return makeMcq(prompt, correct, [correct - 1, correct + 1, correct + both, Math.floor(n / a) + Math.floor(n / b)], 'AMC10', 10);
  }
  const p = randInt(2, 12);
  const q = randInt(2, 12);
  const correct = p * p + q * q;
  const prompt = `If x + y = ${p + q} and xy = ${p * q}, what is x^2 + y^2?`;
  return makeMcq(prompt, correct, [correct - 2, correct + 2, (p + q) * (p + q), p * q], 'AMC10', 10);
}

function genAmc12One() {
  const t = randInt(1, 6);
  if (t === 1) {
    const k = randInt(3, 9);
    const correct = Math.pow(2, k);
    const prompt = `If log2(x) = ${k}, then x =`;
    return makeMcq(prompt, correct, [correct / 2, correct * 2, correct + 2, k * k], 'AMC12', 12);
  }
  if (t === 2) {
    const n = randInt(5, 10);
    const correct = n * (n - 1);
    const prompt = `How many permutations of ${n} distinct objects have two chosen objects adjacent?`;
    return makeMcq(prompt, correct, [n * (n - 1) - 1, n * (n - 2), n * (n - 1) + 1, (n - 1) * (n - 2)], 'AMC12', 12);
  }
  if (t === 3) {
    const a = randInt(2, 8);
    const b = randInt(2, 10);
    const c = randInt(1, 8);
    const sum = `${a + b}/${c}`;
    const prompt = `If sin(theta) = ${a}/${c * 2} and cos(theta) = ${b}/${c * 2}, compute 2(sin(theta)+cos(theta)).`;
    return makeMcq(prompt, sum, [`${a + b + 1}/${c}`, `${a + b - 1}/${c}`, `${a + b}/${c + 1}`, `${a + b}/${c - 1 || 1}`], 'AMC12', 12);
  }
  if (t === 4) {
    const p = randInt(2, 7);
    const q = randInt(2, 7);
    const s = p + q;
    const prompt = `What is the sum of the roots of x^2 - ${s}x + ${p * q} = 0?`;
    return makeMcq(prompt, s, [s - 1, s + 1, p * q, p + q + 2], 'AMC12', 12);
  }
  if (t === 5) {
    const n = randInt(8, 15);
    const k = randInt(2, 5);
    let comb = 1;
    for (let i = 1; i <= k; i += 1) comb = (comb * (n - i + 1)) / i;
    const correct = comb;
    const prompt = `Compute C(${n},${k}).`;
    return makeMcq(prompt, correct, [correct - n, correct + n, correct - k, correct + k], 'AMC12', 12);
  }
  const a = randInt(1, 10);
  const b = randInt(1, 10);
  const c = randInt(1, 10);
  const correct = a * a + b * b + c * c;
  const prompt = `If x=${a}, y=${b}, z=${c}, find x^2+y^2+z^2.`;
  return makeMcq(prompt, correct, [correct - 1, correct + 1, a + b + c, a * b * c], 'AMC12', 12);
}

function genAimeOne() {
  const t = randInt(1, 7);
  if (t === 1) {
    const a = randInt(4, 20);
    const b = randInt(5, 18);
    return makeInput(`Find lcm(${a}, ${b}).`, lcm(a, b), 'AIME', 60);
  }
  if (t === 2) {
    const n = randInt(20, 120);
    return makeInput(`Compute 1^3 + 2^3 + ... + ${n}^3.`, Math.pow((n * (n + 1)) / 2, 2), 'AIME', 60);
  }
  if (t === 3) {
    const x = randInt(11, 99);
    const y = Number(String(x).split('').reverse().join(''));
    return makeInput(`Let N be a two-digit number whose reverse is ${y}. If N is greater than its reverse, find N.`, Math.max(x, y), 'AIME', 60);
  }
  if (t === 4) {
    const a = randInt(2, 9);
    const b = randInt(2, 9);
    const c = randInt(2, 9);
    return makeInput(`Compute (${a}+${b}+${c})^2 - (${a}^2+${b}^2+${c}^2).`, 2 * (a * b + b * c + a * c), 'AIME', 60);
  }
  if (t === 5) {
    const n = randInt(6, 25);
    return makeInput(`Find the ${n}th triangular number.`, (n * (n + 1)) / 2, 'AIME', 60);
  }
  if (t === 6) {
    const a = randInt(100, 500);
    const b = randInt(10, 90);
    return makeInput(`Find the remainder when ${a} is divided by ${b}.`, a % b, 'AIME', 60);
  }
  const a = randInt(2, 25);
  const b = randInt(2, 25);
  return makeInput(`Find gcd(${a}, ${b}).`, gcd(a, b), 'AIME', 60);
}

function buildBank(count, generator) {
  const out = [];
  const seen = new Set();
  let guard = 0;
  while (out.length < count && guard < count * 200) {
    guard += 1;
    const q = generator();
    if (!q) continue;
    if (seen.has(q.prompt)) continue;
    seen.add(q.prompt);
    out.push({ id: out.length + 1, ...q });
  }
  if (out.length < count) {
    throw new Error(`Could only generate ${out.length} questions, needed ${count}`);
  }
  return out;
}

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const banks = {
  amc8: buildBank(400, genAmc8One),
  amc10: buildBank(400, genAmc10One),
  amc12: buildBank(400, genAmc12One),
  aime: buildBank(400, genAimeOne),
};

for (const [name, items] of Object.entries(banks)) {
  fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(items, null, 2) + '\n', 'utf8');
}

console.log('Generated banks:', Object.fromEntries(Object.entries(banks).map(([k, v]) => [k, v.length])));
