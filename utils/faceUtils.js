const faceapi = require('@vladmandic/face-api');
const Jimp = require('jimp');
const tf = require('@tensorflow/tfjs-core');
require('@tensorflow/tfjs-backend-cpu');
require('@tensorflow/tfjs-converter');
const path = require('path');

class StubElement {
  constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; this.complete = true; }
  addEventListener() {}
  removeEventListener() {}
  getContext() { return null; }
  toDataURL() { return ''; }
}

faceapi.env.monkeyPatch({
  Canvas: StubElement,
  Image: StubElement,
  ImageData: function() {},
  HTMLVideoElement: StubElement,
});

const MODELS_PATH = path.join(__dirname, '../models/face_models');

let modelsLoaded = false;
let modelsLoadingPromise = null;

async function ensureModelsLoaded() {
  if (modelsLoaded) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;
  modelsLoadingPromise = (async () => {
    await tf.ready();
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
    modelsLoaded = true;
    modelsLoadingPromise = null;
  })();
  return modelsLoadingPromise;
}

async function bufferToTensor(buffer) {
  const image = await Jimp.read(buffer);
  const { data, width, height } = image.bitmap;
  const tfimage = tf.tensor3d(new Float32Array(data), [height, width, 4]);
  const rgb = tf.slice(tfimage, [0, 0, 0], [height, width, 3]);
  tfimage.dispose();
  return rgb;
}

function base64ToBuffer(base64) {
  const matches = base64.match(/^data:image\/[a-z]+;base64,(.+)$/);
  const data = matches ? matches[1] : base64;
  return Buffer.from(data, 'base64');
}

async function extractDescriptor(input) {
  await ensureModelsLoaded();

  let buffer;
  if (typeof input === 'string') {
    buffer = base64ToBuffer(input);
  } else if (Buffer.isBuffer(input)) {
    buffer = input;
  } else {
    throw new Error('Input must be a Buffer or base64 string');
  }

  const tensor = await bufferToTensor(buffer);

  try {
    const detection = await faceapi
      .detectSingleFace(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return null;

    return Array.from(detection.descriptor);
  } finally {
    tf.dispose(tensor);
  }
}

function compareDescriptors(d1, d2, threshold = 0.5) {
  if (!d1 || !d2 || d1.length !== 128 || d2.length !== 128) {
    return { match: false, distance: Infinity };
  }
  const distance = faceapi.euclideanDistance(d1, d2);
  return { match: distance <= threshold, distance };
}

module.exports = { extractDescriptor, compareDescriptors };