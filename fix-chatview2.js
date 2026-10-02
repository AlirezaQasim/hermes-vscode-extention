const fs = require('fs');
const content = fs.readFileSync('src/ui/chatView.ts', 'utf8');
const fixed = content
  .replace(/\\\\\\$/g, '$')
  .replace(/\\\\`/g, '`')
  .replace(/\\\\\"/g, '"')
  .replace(/\\\\n/g, '\n');
fs.writeFileSync('src/ui/chatView.ts', fixed);
console.log('Fixed');