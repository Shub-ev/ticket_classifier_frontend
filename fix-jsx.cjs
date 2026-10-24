const fs = require('fs');
const AMP = String.fromCharCode(38);
const GT = AMP + 'gt;'; // entity that keeps JSX text literal
const fixes = [
  ['src/pages/Dashboard.jsx', [['✓ Confidence > 80% SLA Threshold', '✓ Confidence ' + GT + ' 80% SLA Threshold']]],
  ['src/pages/HumanReview.jsx', [['Batch Auto-Approve (>75%)', 'Batch Auto-Approve (' + GT + '75%)']]],
];
let total = 0;
for (const [path, pairs] of fixes) {
  let s = fs.readFileSync(path, 'utf8');
  for (const [from, to] of pairs) {
    if (s.includes(from)) { s = s.split(from).join(to); total++; }
  }
  fs.writeFileSync(path, s);
}
console.log('fixes applied:', total);
