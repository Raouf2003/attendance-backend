const admin = require('firebase-admin');

let initialized = false;

function initFirebase() {
  if (initialized) return;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON not set. FCM notifications disabled.');
    return;
  }
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    console.log('[FCM] Firebase Admin initialized');
  } catch (err) {
    console.error('[FCM] Firebase init error:', err.message);
  }
}

function isFcmEnabled() {
  return initialized;
}

async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!initialized || !fcmToken) return false;
  try {
    const message = {
      token: fcmToken,
      notification: { title, body },
      data,
    };
    await admin.messaging().send(message);
    return true;
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered') {
      console.warn(`[FCM] Token not registered (removing): ${fcmToken.slice(0, 20)}...`);
      return false;
    }
    console.error('[FCM] Send error:', err.message);
    return false;
  }
}

async function sendMulticastPushNotification(tokens, title, body, data = {}) {
  if (!initialized || !tokens || tokens.length === 0) return { success: 0, failure: 0 };
  try {
    const message = {
      tokens,
      notification: { title, body },
      data,
    };
    const response = await admin.messaging().sendEachForMulticast(message);
    return {
      success: response.successCount,
      failure: response.failureCount,
    };
  } catch (err) {
    console.error('[FCM] Multicast error:', err.message);
    return { success: 0, failure: tokens.length };
  }
}

module.exports = {
  initFirebase,
  isFcmEnabled,
  sendPushNotification,
  sendMulticastPushNotification,
};
