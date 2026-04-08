const fs = require('fs/promises');
const path = require('path');

const root = process.cwd();
const distDir = path.join(root, 'dist');

async function build() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(path.join(distDir, 'admin'), { recursive: true });

  await Promise.all([
    fs.copyFile(path.join(root, 'index.html'), path.join(distDir, 'index.html')),
    fs.copyFile(path.join(root, 'subham.jpg'), path.join(distDir, 'subham.jpg')),
    fs.copyFile(path.join(root, 'admin', 'index.html'), path.join(distDir, 'admin', 'index.html'))
  ]);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
