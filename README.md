# Noctra for Android

Noctra is an independent, non-commercial music player for Android. It streams
from YouTube, YouTube Music and SoundCloud, keeps a local library, downloads
songs for offline listening, shows synced lyrics and includes a full player UI.

This repository is the Android build of Noctra. It is based on
[Muriel](https://github.com/cloverscripts/riff-muriel), which is based on
[Riff](https://github.com/rootscripts/riff) by rootscripts. All upstream
projects are MIT-licensed; see [LICENSE](LICENSE) and [NOTICE](NOTICE).

> Noctra is not affiliated with YouTube, Google, SoundCloud, Spotify or Apple.
> It hosts no music. Use it for private listening and only download music you
> have the right to. See [LEGAL.md](LEGAL.md).

## Current mobile work

- Noctra name, package id, icons and splash screens.
- Circular Play button in the mini player and Now Playing sheet.
- No top app logo; the profile avatar sits in the bottom bar.
- “Hidden menu” switch: hide the bottom bar and use a desktop-style side rail
  that slides in from the left edge.
- Local files are hidden from navigation by default; re-enable them in
  Settings → Tracks → “Show local”.
- The playlist button opens a full-screen Playlists page instead of the old
  bottom sheet.
- Android 7+ (`minSdk 24`), target SDK 36.

Still being ported from the desktop Noctra build: custom Home, listener
profile, live background, the desktop settings layout and the remaining
Noctra sliders.

## Preview on a PC

```bash
npm run mobile:preview
```

This builds the mobile bundle, starts the local preview server and opens the
interface in a phone-sized Edge/Chrome window. It is a UI preview: Android
notifications, background playback and other native services run only in the APK.

## Build

Requirements: Node.js 22+, JDK 21 and the Android SDK.

```bash
npm ci
node mobile/build.mjs
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

For a release APK, provide a keystore through the `NOCTRA_KEYSTORE`,
`NOCTRA_KEYSTORE_PASSWORD` and `NOCTRA_KEY_PASSWORD` environment variables and
run `./gradlew assembleRelease`.

The GitHub Actions workflow in `.github/workflows/android.yml` builds an APK.
When the keystore secrets are configured, it publishes a signed `Noctra.apk`;
without them it publishes a debug APK for testing.

## Data

Android keeps the library inside the app's storage. Downloaded songs are saved
to `Music/Noctra`, so other music apps can see them.

## Legal

Noctra is a player: it does not host, upload or sell music, has no ads, accounts
or tracking, and nobody earns money from it. You are responsible for using it
in line with copyright and the terms of the services you use. Rights holders
can use the issue tracker in this repository. Details: [LEGAL.md](LEGAL.md).

## License

MIT. Original Riff code © rootscripts; Muriel code © cloverscripts;
Noctra modifications © Noctra contributors.
