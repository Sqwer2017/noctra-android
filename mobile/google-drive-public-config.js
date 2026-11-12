// Public Android OAuth client for Google Drive in CI/release builds.
// Android OAuth clients are public and use PKCE; there is no client secret here.
// A local mobile/google-drive-config.js (gitignored) overrides this file.
window.NOCTRA_GOOGLE_DRIVE = {
  clientId: '454232821400-4hhfs8auq14adj2ac90s9ai5l0d7ngdg.apps.googleusercontent.com',
  clientSecret: '',
  redirectUri: 'com.googleusercontent.apps.454232821400-4hhfs8auq14adj2ac90s9ai5l0d7ngdg:/oauth2redirect'
};
