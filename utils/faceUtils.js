function compareDescriptors(d1, d2, threshold = 0.6) {
  if (!d1 || !d2 || !Array.isArray(d1) || !Array.isArray(d2)) {
    return { match: false, distance: Infinity };
  }
  if (d1.length !== d2.length || d1.length === 0) {
    return { match: false, distance: Infinity };
  }
  let sum = 0;
  for (let i = 0; i < d1.length; i++) {
    const diff = d1[i] - d2[i];
    sum += diff * diff;
  }
  const distance = Math.sqrt(sum);
  return { match: distance <= threshold, distance };
}

function validateDescriptor(descriptor) {
  if (!Array.isArray(descriptor)) return false;
  if (descriptor.length === 0) return false;
  for (const v of descriptor) {
    if (typeof v !== 'number' || !isFinite(v)) return false;
  }
  return true;
}

module.exports = { compareDescriptors, validateDescriptor };