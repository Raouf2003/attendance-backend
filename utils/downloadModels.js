const fs = require('fs');
const path = require('path');
const https = require('https');

const MODELS_DIR = path.join(__dirname, '../models/face_models');
const BASE_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';

const MODEL_FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function downloadModels() {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  console.log('Downloading face-api models...');

  for (const file of MODEL_FILES) {
    const dest = path.join(MODELS_DIR, file);
    if (fs.existsSync(dest)) {
      console.log(`Skipping ${file} (already exists)`);
      continue;
    }

    const url = BASE_URL + file;
    console.log(`Downloading ${file}...`);
    try {
      await downloadFile(url, dest);
      console.log(`Downloaded ${file}`);
    } catch (err) {
      console.error(`Failed to download ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log('All models downloaded successfully!');
}

downloadModels();