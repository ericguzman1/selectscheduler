#!/bin/bash

# build.sh
# This script injects your private Vercel environment variables into index.html
# during the deployment process. 

# Replace Firebase API Key
sed -i "s|VITE_FIREBASE_API_KEY_PLACEHOLDER|$VITE_FIREBASE_API_KEY|g" index.html

# Replace Firebase Auth Domain
sed -i "s|VITE_FIREBASE_AUTH_DOMAIN_PLACEHOLDER|$VITE_FIREBASE_AUTH_DOMAIN|g" index.html

# Replace Firebase Project ID (used for project ID and storage bucket)
sed -i "s|VITE_FIREBASE_PROJECT_ID_PLACEHOLDER|$VITE_FIREBASE_PROJECT_ID|g" index.html

# Replace Firebase Messaging Sender ID
sed -i "s|VITE_FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER|$VITE_FIREBASE_MESSAGING_SENDER_ID|g" index.html

# Replace Firebase App ID
sed -i "s|VITE_FIREBASE_APP_ID_PLACEHOLDER|$VITE_FIREBASE_APP_ID|g" index.html

# Replace Gemini API Key
sed -i "s|VITE_GEMINI_API_KEY_PLACEHOLDER|$VITE_GEMINI_API_KEY|g" index.html

echo "Build complete: All environment variables have been securely injected into index.html."
