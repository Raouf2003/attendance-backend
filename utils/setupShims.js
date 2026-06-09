const fs = require('fs');
const path = require('path');

const shims = [
  {
    name: '@tensorflow/tfjs-node',
    index: `const tf = require('@tensorflow/tfjs-core');
module.exports = {
  version: {
    tfjs: '4.22.0',
    'tfjs-core': '4.22.0',
    'tfjs-converter': '4.22.0',
    'tfjs-backend-cpu': '4.22.0',
    'tfjs-node': '0.0.0',
  },
  io: { fileSystem: () => { throw new Error('Shim: not available'); } },
  ...tf,
};
`,
  },
  {
    name: '@tensorflow/tfjs-node-gpu',
    index: `const tf = require('@tensorflow/tfjs-core');
module.exports = {
  version: {
    tfjs: '4.22.0',
    'tfjs-core': '4.22.0',
    'tfjs-converter': '4.22.0',
    'tfjs-backend-cpu': '4.22.0',
    'tfjs-node-gpu': '0.0.0',
  },
  io: { fileSystem: () => { throw new Error('Shim: not available'); } },
  ...tf,
};
`,
  },
];

for (const shim of shims) {
  const dir = path.join(__dirname, '..', 'node_modules', shim.name);
  const distDir = path.join(dir, 'dist');
  const pkgPath = path.join(dir, 'package.json');
  const indexPath = path.join(distDir, 'index.js');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: shim.name,
      version: '0.0.0',
      main: 'dist/index.js',
      private: true,
    }, null, 2));
    fs.writeFileSync(indexPath, shim.index);
    console.log(`Created shim: ${shim.name}`);
  } else {
    if (!fs.existsSync(indexPath)) {
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(indexPath, shim.index);
      console.log(`Created shim index: ${shim.name}`);
    } else {
      console.log(`Shim already exists: ${shim.name}`);
    }
  }
}
