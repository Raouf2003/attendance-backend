const faceapi = require('@vladmandic/face-api');
const { Canvas, Image, ImageData } = require('canvas');
const fs = require('fs');
const path = require('path');

faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODELS_PATH = path.join(__dirname, '../models/face_models');

async function loadModels() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
}

let modelsLoaded = false;
let modelsLoadingPromise = null;

async function ensureModelsLoaded() {
  if (modelsLoaded) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;
  modelsLoadingPromise = loadModels().then(() => {
    modelsLoaded = true;
    modelsLoadingPromise = null;
  });
  return modelsLoadingPromise;
}

function bufferToImage(buffer) {
  const img = new Image();
  img.src = buffer;
  return img;
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

  const img = bufferToImage(buffer);

  const detection = await faceapi
    .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return null;
  }

  return Array.from(detection.descriptor);
}

function compareDescriptors(d1, d2, threshold = 0.5) {
  if (!d1 || !d2 || d1.length !== 128 || d2.length !== 128) {
    return { match: false, distance: Infinity };
  }

  const distance = faceapi.euclideanDistance(d1, d2);
  return {
    match: distance <= threshold,
    distance,
  };
}

module.exports = {
  extractDescriptor,
  compareDescriptors,
};