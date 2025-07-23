const fs = require('fs');
const path = require('path');

console.log('Searching for web directory...\n');

const possiblePaths = [
  path.join(__dirname, 'dist', 'web'),
  path.join(__dirname, 'web'),
  path.join(__dirname, 'dist', 'core', '..', 'web'),
  path.join(process.cwd(), 'dist', 'web'),
  path.join(process.cwd(), 'web')
];

possiblePaths.forEach(p => {
  console.log(`Checking: ${p}`);
  if (fs.existsSync(p)) {
    console.log('  ✓ EXISTS');
    const files = fs.readdirSync(p);
    console.log('  Files:', files);
  } else {
    console.log('  ✗ NOT FOUND');
  }
});

console.log('\nCurrent directory:', process.cwd());
console.log('Script directory:', __dirname);