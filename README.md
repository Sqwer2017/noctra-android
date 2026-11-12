# Noctra for Android

[![Download APK](https://img.shields.io/badge/Download-Noctra%200.1.0%20Beta-8b5cf6?style=for-the-badge)](https://github.com/Sqwer2017/noctra-android/releases/download/v0.1.0-beta.1/Noctra-0.1.0-beta.1.apk)
[![Beta release](https://img.shields.io/badge/GitHub-Release%20notes-181717?style=for-the-badge&logo=github)](https://github.com/Sqwer2017/noctra-android/releases/tag/v0.1.0-beta.1)

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

## Download the beta

**Noctra 0.1.0 Beta 1** · Android 7.0+ (API 24) · ~13 MB

- [Download APK](https://github.com/Sqwer2017/noctra-android/releases/download/v0.1.0-beta.1/Noctra-0.1.0-beta.1.apk)
- [Release notes](https://github.com/Sqwer2017/noctra-android/releases/tag/v0.1.0-beta.1)
- SHA-256: `dd370df656afca5fcf58470d31b0e3e33dfc6770fa5c33360e03818746cb8ad2`

The beta APK is **debug-signed** for testing. Allow installation from unknown
sources in Android settings. A future stable build will use a permanent release
key, so beta users may need to reinstall once when switching to it.

Google Drive backup is **not configured** in the public beta: the OAuth client
secret is intentionally excluded from published builds.

## What is included

- YouTube, YouTube Music and SoundCloud sources with a floating search bar.
- Noctra Home with daily discovery, live background and feature sections.
- Mini player and full-screen Now Playing with cover glow, lyrics, karaoke,
  Speed & Pitch and a thick timeline.
- Listener profile with XP ranks, daily quests, all 20 achievements, custom
  avatar, banner, bio and atmospheric effects.
- Favorites, playlists, albums, artists, local files, history and downloads.
- Side navigation, light/dark themes, configurable waves and PC-style sliders.
- Android 7+ (`minSdk 24`), target SDK 36.

## Install

1. Download the APK above on the phone.
2. Open it and allow installation from unknown sources for your browser or file
   manager when Android asks.
3. Install and open Noctra.

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
`NOCTRA_KEYSTORE_PASSWORD`, `NOCTRA_KEY_ALIAS` and `NOCTRA_KEY_PASSWORD`
environment variables and run `./gradlew assembleRelease`.

The GitHub Actions workflow in `.github/workflows/android.yml` builds an APK.
When the keystore secrets are configured, it publishes a signed `Noctra.apk`;
without them it publishes a debug APK for testing.

## Google Drive

Google Drive backup uses `drive.appdata` and is optional. It needs a Google
OAuth client created for this app. The client secret is never committed: put
local credentials in `mobile/google-drive-config.js` (gitignored). For public
builds prefer an Android OAuth client with the package name and signing SHA-1,
which does not require a client secret.

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
