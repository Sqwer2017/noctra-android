// Copy to mobile/google-drive-config.js (gitignored) for local builds.
// For an Android OAuth client, use an Android client ID and the custom scheme
// noctra://oauth2redirect registered in Google Cloud.
window.NOCTRA_GOOGLE_DRIVE = {
  clientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  clientSecret: '',
  redirectUri: 'noctra://oauth2redirect'
};
