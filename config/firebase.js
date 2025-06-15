const admin = require('firebase-admin');

// Firebase Admin SDK configuration
const firebaseConfig = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "demo_key_id",
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') || "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKB\nDemo_Private_Key_Content_Here\n-----END PRIVATE KEY-----\n",
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-demo@sallah-22eb7.iam.gserviceaccount.com",
  client_id: process.env.FIREBASE_CLIENT_ID || "demo_client_id",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL || "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-demo%40sallah-22eb7.iam.gserviceaccount.com"
};

// Initialize Firebase Admin (with error handling for demo environment)
let auth, storage, messaging;

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
  }

  auth = admin.auth();
  storage = admin.storage();
  messaging = admin.messaging();
  
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.warn('Firebase Admin initialization failed (demo mode):', error.message);
  
  // Create mock objects for demo environment
  auth = {
    verifyIdToken: async (token) => {
      // Mock token verification for demo
      return {
        uid: 'demo_user_' + Date.now(),
        email: 'demo@example.com',
        name: 'Demo User'
      };
    },
    createCustomToken: async (uid, claims) => {
      return 'demo_custom_token_' + uid;
    },
    getUserByEmail: async (email) => {
      return {
        uid: 'demo_user_' + Date.now(),
        email: email,
        displayName: 'Demo User'
      };
    },
    setCustomUserClaims: async (uid, claims) => {
      return true;
    },
    updateUser: async (uid, properties) => {
      return { uid, ...properties };
    }
  };

  storage = {
    bucket: () => ({
      file: (path) => ({
        createWriteStream: () => ({
          on: (event, callback) => {
            if (event === 'finish') {
              setTimeout(() => callback(), 100);
            }
          },
          end: () => {}
        }),
        makePublic: async () => {},
        delete: async () => {}
      })
    })
  };

  messaging = {
    send: async (message) => {
      console.log('Mock FCM message sent:', message.notification?.title);
      return 'demo_message_id_' + Date.now();
    },
    sendMulticast: async (message) => {
      console.log('Mock FCM multicast sent:', message.notification?.title);
      return {
        successCount: message.tokens?.length || 0,
        failureCount: 0
      };
    }
  };
}

// Helper function to verify Firebase token
const verifyFirebaseToken = async (idToken) => {
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    throw new Error('Invalid Firebase token');
  }
};

// Helper function to create custom token
const createCustomToken = async (uid, additionalClaims = {}) => {
  try {
    const customToken = await auth.createCustomToken(uid, additionalClaims);
    return customToken;
  } catch (error) {
    throw new Error('Failed to create custom token');
  }
};

// Helper function to send push notification
const sendPushNotification = async (fcmToken, notification, data = {}) => {
  try {
    const message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl
      },
      data: data,
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#2196F3',
          sound: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    const response = await messaging.send(message);
    return response;
  } catch (error) {
    console.error('Error sending push notification:', error);
    throw error;
  }
};

// Helper function to send push notification to multiple tokens
const sendMulticastNotification = async (fcmTokens, notification, data = {}) => {
  try {
    const message = {
      tokens: fcmTokens,
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl
      },
      data: data,
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#2196F3',
          sound: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    const response = await messaging.sendMulticast(message);
    return response;
  } catch (error) {
    console.error('Error sending multicast notification:', error);
    throw error;
  }
};

// Helper function to upload file to Firebase Storage
const uploadToStorage = async (file, path) => {
  try {
    const bucket = storage.bucket();
    const fileUpload = bucket.file(path);
    
    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    return new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', async () => {
        await fileUpload.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;
        resolve(publicUrl);
      });
      stream.end(file.buffer);
    });
  } catch (error) {
    throw new Error('Failed to upload file to storage');
  }
};

// Helper function to delete file from Firebase Storage
const deleteFromStorage = async (path) => {
  try {
    const bucket = storage.bucket();
    await bucket.file(path).delete();
    return true;
  } catch (error) {
    console.error('Error deleting file from storage:', error);
    return false;
  }
};

// Helper function to get user by email
const getUserByEmail = async (email) => {
  try {
    const userRecord = await auth.getUserByEmail(email);
    return userRecord;
  } catch (error) {
    throw new Error('User not found');
  }
};

// Helper function to update user claims
const setCustomUserClaims = async (uid, claims) => {
  try {
    await auth.setCustomUserClaims(uid, claims);
    return true;
  } catch (error) {
    throw new Error('Failed to set custom claims');
  }
};

// Helper function to disable user
const disableUser = async (uid) => {
  try {
    await auth.updateUser(uid, { disabled: true });
    return true;
  } catch (error) {
    throw new Error('Failed to disable user');
  }
};

// Helper function to enable user
const enableUser = async (uid) => {
  try {
    await auth.updateUser(uid, { disabled: false });
    return true;
  } catch (error) {
    throw new Error('Failed to enable user');
  }
};

module.exports = {
  admin,
  auth,
  storage,
  messaging,
  verifyFirebaseToken,
  createCustomToken,
  sendPushNotification,
  sendMulticastNotification,
  uploadToStorage,
  deleteFromStorage,
  getUserByEmail,
  setCustomUserClaims,
  disableUser,
  enableUser
};

