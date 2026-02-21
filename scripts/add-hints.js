const fs = require('fs');
const path = require('path');

const files = ['amc8.json', 'amc10.json', 'amc12.json', 'aime.json'];
const dataDir = path.join(process.cwd(), 'data');

function buildHint(item) {
  const p = item.prompt.toLowerCase();

  if (p.includes('remainder')) return 'Use modular arithmetic and reduce each term before combining them.';
  if (p.includes('divisor') || p.includes('factor')) return 'Prime-factorize the number first, then apply the divisor-count rule.';
  if (p.includes('perimeter')) return 'Write the perimeter formula and substitute the known side lengths.';
  if (p.includes('area')) return 'Identify the shape formula, then plug in the given dimensions carefully.';
  if (p.includes('probability') || p.includes('p(') || p.includes('marble')) return 'Probability is favorable outcomes divided by total outcomes.';
  if (p.includes('average')) return 'Average = sum / count, so convert between sum and average using the number of terms.';
  if (p.includes('log')) return 'Rewrite the logarithm in exponential form to isolate the variable.';
  if (p.includes('root')) return 'Use Vieta or direct expansion to relate roots to coefficients.';
  if (p.includes('permutation')) return 'Count arrangements with a structured method instead of listing cases.';
  if (p.includes('diagonal')) return 'Use the n-gon diagonal formula: n(n-3)/2.';
  if (p.includes('gcd')) return 'Factor both numbers and keep only shared prime powers.';
  if (p.includes('lcm')) return 'Prime-factorize and take the highest power of each prime.';
  if (p.includes('triangular number')) return 'Use n(n+1)/2 for the nth triangular number.';
  if (p.includes('sin') || p.includes('cos') || p.includes('theta')) return 'Use core trig identities and simplify step by step.';
  if (p.includes('choose') || p.includes('c(')) return 'Use combinations formula n!/(k!(n-k)!).';
  if (p.includes('x^2') || p.includes('equation')) return 'Move everything into one equation, then solve systematically.';

  if (item.label === 'AIME') return 'Translate the statement into equations first, then compute carefully.';
  if (item.label === 'AMC12') return 'Set up the algebraic structure first, then simplify deliberately.';
  if (item.label === 'AMC10') return 'Look for a standard contest formula before doing long computation.';
  return 'Identify the target quantity, write a clean equation, and solve it step by step.';
}

for (const file of files) {
  const full = path.join(dataDir, file);
  const raw = fs.readFileSync(full, 'utf8');
  const items = JSON.parse(raw);
  const next = items.map((item) => ({
    ...item,
    hint: buildHint(item)
  }));
  fs.writeFileSync(full, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

console.log('Added hints to all dataset files.');
