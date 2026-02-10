sed -i "s|VITE_API_KEY_MARKER|$VITE_FIREBASE_API_KEY|g" index.html
sed -i "s|VITE_AUTH_DOMAIN_MARKER|$VITE_FIREBASE_AUTH_DOMAIN|g" index.html
sed -i "s|VITE_PROJECT_ID_MARKER|$VITE_FIREBASE_PROJECT_ID|g" index.html
sed -i "s|VITE_FIREBASE_APP_ID_PLACEHOLDER|$VITE_FIREBASE_APP_ID|g" index.html
sed -i "s|VITE_GEMINI_MARKER|$VITE_GEMINI_API_KEY|g" index.html

echo "Environment Variables Injected Successfully."
