import sharp from 'sharp';
import fs from 'fs';

const svg = fs.readFileSync('resources/icon.svg');
sharp(svg)
  .resize(128, 128)
  .png()
  .toFile('resources/icon.png')
  .then(() => console.log('Icon converted successfully'))
  .catch(err => console.error('Error:', err));