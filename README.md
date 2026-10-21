# Mock GPS Tester

Android GPS testing application using React Native, TypeScript, native Kotlin, and supported Android mock-location APIs. The app opens on a full-screen map in the style of popular "GPS emulator" apps: move the map under the center pin, press play, and the device reports that location. Core simulation runs locally, independently of the optional FastAPI backend.

**Implementation and automated builds are available. Device execution was explicitly deferred by the user because no phone/emulator is connected. This is a development build, not a device-verified or production-certified release.**

## Implemented

- **GPS emulator map (home screen):** full-screen MapLibre map with a fixed center pin, live pin coordinates (tap to share), a big play/stop button, pause/resume, and **Location / Route / Joystick** modes. Tap the map to move the pin; long-press for actions (mock here, add to favorites, add route waypoint, set radius target, share coordinates).
- **Place search:** search bar for place names (OpenStreetMap Nominatim, on submit only) or typed `latitude, longitude` coordinates, which work offline.
- **Live moves:** while a location is mocked, pan the map and choose **Move mock here** to teleport without restarting the service. A **follow** button keeps the camera on the mocked location.
- **Joystick mode:** start at the pin, then drag the on-screen joystick to walk or drive. Up on screen follows the map rotation; Walk/Run/Bike/Car presets set the top speed (5/10/20/60 km/h). Native steering stops on its own if joystick updates stop for 3 seconds, so a lost touch or a closed app never leaves the location drifting. TalkBack users can steer with the joystick's north/east/south/west/stop actions.
- **Route mode:** tap the map (or **+ Pin**) to draw waypoints with A/B markers, undo/clear, Walk/Bike/Car speed presets, loop toggle, live distance/ETA, progress and remaining distance while driving, and save to Saved Routes.
- **Favorites and history:** star button to save or remove the pin as a named favorite; the last 20 mocked locations are kept as history in Favorites.
- **Map styles:** Streets, Bright, Light and Dark (OpenFreeMap), and Satellite (Esri World Imagery). The chosen style persists.
- **Side menu:** Favorites & history, Saved routes, Enter coordinates, Simulation status, Settings, Device setup (flagged when action is needed), and Cloud presets. A banner on the map links to Device Setup when mock-location setup is incomplete or a setup error occurs.
- **Self-diagnosis instead of blank screens:** JavaScript errors show a readable error screen with **Try again**, **Share details** and **Reset saved data**. Native crashes and fatal React Native errors are written to app storage, and the next launch shows **The app closed unexpectedly last time** with a **Share report** button, so testers can send details without USB debugging. If the map started but never reported back (a freeze or crash in the map), the next launch opens in **Map paused** mode, where everything except the map still works, with a **Load map** button. Startup never waits more than 8 seconds for saved data.
- Captured-real and simulated markers, target radius circle, map retry and manual coordinate entry.
- Foreground Kotlin simulation service, start/pause/resume/stop, persistent notification controls, status events, precise-location/mock-app prerequisites, and provider cleanup/recovery.
- WGS84 route interpolation using GeographicLib, continuous return legs for loops, speed, duration, interval, progress, destination waypoint, and remaining distance.
- Default 100 m radius testing with strict `distance < radius`, optionally inclusive; Turf distance calculations and map circles.
- Validated local location CRUD, route CRUD, history, settings and selections persisted in AsyncStorage through Zustand. Invalid restored data is rejected with an error; data saved by earlier versions (without history) still loads.
- Simulation Status, Location Details, Favorites, Saved Routes, Settings, and optional Cloud Presets screens with light/dark themes.
- FastAPI, SQLAlchemy, PostgreSQL-compatible Alembic migrations, Argon2 passwords, expiring JWTs, ownership-scoped location/route CRUD, rate limits, and request validation.
- Optional Axios cloud login/register, upload/download copies, paginated listing, and cloud deletion. Tokens stay in memory; cloud outages do not stop native simulation.

### Observed verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, no warnings |
| `npm test -- --runInBand` | Pass, 75 tests in 8 suites: emulator map (play/stop, move here, route drawing, joystick steering, search and search races, favorites, map styles, long-press, setup banners, map safe mode, malformed map events), diagnostics (error screen, global error capture, crash report notice, startup timeout), navigation, joystick math/throttle, geocoding, geometry, persistence/history, native contract, status races, cloud |
| Gradle wrapper `--version` | Pass, Gradle 9.4.1 downloaded using Windows certificate trust |
| React Native Gradle plugins | Compiled using the approved Maven mirror |
| SDK tools, Platform 37.0, Build Tools 37.0.0, CMake 3.22.1 | Installed and verified |
| NDK 27.1.12297006 | Official archive checksum verified; compiler runs |
| `adb version` / `adb devices` | Platform-Tools 37.0.1 runs; no device connected |
| Android `:app:assembleDebug` | Pass; full native map, storage, service, and bridge |
| Kotlin `:app:testDebugUnitTest` | Pass, 11 tests: lifecycle, invalid inputs, date line, completion, continuous loops, joystick steering, steering timeout, paused joystick, teleport vs. routes, crash report format and size cap |
| `:app:assembleDebugAndroidTest` | Pass; device lifecycle test APK compiles; execution pending |
| Backend pytest | Pass, 7 tests: auth, ownership, CRUD, rate limits, validation, migrations |
| Metro production Android bundle | Pass; bundle and 22 asset files generated |
| Local development servers | Metro port 8081; API port 8000, health and OpenAPI checked |
| PostgreSQL | Migration SQL generated; no local server/Docker available for a live test |
| Debug APK signature | Pass; verified with Android apksigner |
| Run on emulator/device | No emulator installed or authorized device connected |
| Editor Python environment | Select `.venv/Scripts/python.exe`; system interpreter lacks backend packages |

## Supported mock locations only

Android's supported mock-location configuration is required. Enable Developer Options and select **Mock GPS Tester** under **Select mock location app**. Enable device Location and grant precise location permission. Allow notifications so foreground controls are visible.

Open **Device Setup** from the side menu (or the map's setup banner) for a live checklist of Developer Options, mock location app, precise location, Location services, and notifications. Each item shows its status and a button that opens the matching Android Settings screen; the status refreshes when you return to the app. Android does not allow apps to turn Developer Options on or off, so the user always flips the switch: to enable, tap **Build number** 7 times in About phone; to disable, turn off the switch at the top of Developer Options (blocked in-app while a simulation is active). Some manufacturers' Settings screens differ; if a screen is unavailable, general Settings opens instead.

The native implementation reports missing configuration with:

> Mock location is not enabled for this application. Select this application as the mock location app in Android Developer Options.

No Developer Options, root, Play Integrity, mock-location detection, anti-cheat, or third-party security bypasses are permitted. No hidden injection or modification of other apps. Test only devices and applications you are authorized to test.

## Prerequisites and dependencies

Only the tools in the first table must be installed manually. npm, Gradle and pip download the libraries listed below from the project's lock/build/requirements files. Expo and Expo Go are **not** used and cannot run this app because it contains custom native Kotlin code.

### Tools to install

| Tool | Version | Needed for |
| --- | --- | --- |
| Git | Any current version | Cloning the repository |
| Node.js (includes npm) | `^22.13.0`, `^24.3.0` or `>=26.0.0`; tested with 24.20.0 | Mobile dependencies, Metro, tests, JavaScript bundle |
| JDK | 17 recommended by React Native; this project was also built with Java 26 | Gradle, Kotlin and Android builds |
| Android Studio or Android command-line tools | Current version | Android SDK Manager, optional emulator |
| Android SDK Platform | `platforms;android-37.0` (compile SDK 37) | Android build |
| Android SDK Build-Tools | `build-tools;37.0.0` | Android build and `apksigner` |
| Android SDK Platform-Tools | Current version; tested with 37.0.1 | `adb` install/debug |
| Android NDK | `ndk;27.1.12297006` | React Native native libraries |
| CMake | `cmake;3.22.1` | React Native native libraries |
| Android phone or emulator | Android 7.0+ (API 24); app targets API 36 | Running the app |
| Python | 3.13 (tested) | Optional backend only |
| PostgreSQL | Current supported version (live run not yet verified) | Optional production backend only; SQLite works for local development |

Gradle 9.4.1 does not need a separate install: the committed `gradlew` wrapper downloads it. Kotlin 2.2.0, the Android Gradle plugin and the React Native Gradle plugin are also downloaded by Gradle. Follow the [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment) for platform-specific installation.

Set `JAVA_HOME` to the JDK and select the same JDK as the Gradle JDK in Android Studio. Set `ANDROID_HOME` to the SDK location, usually `%LOCALAPPDATA%\Android\Sdk` on Windows, and add `%ANDROID_HOME%\platform-tools` to `PATH` (also `%ANDROID_HOME%\emulator` if you use an emulator). Android Studio can alternatively create `mobile/android/local.properties` with the SDK path; do not commit that machine-specific file. Accept SDK licenses yourself.

Install all required SDK packages with the SDK Manager command shown in [User-local SDK configuration](#user-local-sdk-configuration).

### Mobile libraries (installed by `npm ci`)

| Package | Version |
| --- | --- |
| `react-native` / `react` | 0.87.1 / 19.2.3 |
| `@react-navigation/native` / `@react-navigation/native-stack` | 7.3.18 / 7.18.10 |
| `react-native-screens` / `react-native-safe-area-context` | 4.27.0 / ^5.5.2 |
| `@maplibre/maplibre-react-native` | 11.2.0, with the committed patch in `mobile/patches` |
| `@react-native-async-storage/async-storage` | 2.2.0 |
| `zustand` | 5.0.15 |
| `@turf/along`, `@turf/circle`, `@turf/distance`, `@turf/helpers`, `@turf/length` | 7.3.5 |
| `axios` | ^1.20.0 |

Development tools installed by `npm ci`: TypeScript ^6.0.3, Jest ^29.6.3, ESLint ^8.19.0, Prettier 2.8.8, React Native CLI 20.2.0, React Native Babel/Metro/Jest presets 0.87.1, React Test Renderer 19.2.3 and `patch-package` 8.0.1. `patch-package` runs automatically after `npm ci` and applies the MapLibre compatibility fix; do not install with `--ignore-scripts`.

### Android native libraries (downloaded by Gradle)

| Library | Version | Purpose |
| --- | --- | --- |
| `net.sf.geographiclib:GeographicLib-Java` | 2.1 | WGS84 route interpolation |
| `com.facebook.react:react-android` / Hermes | Matched to React Native 0.87.1 | React Native runtime |
| `junit:junit` | 4.13.2 | Kotlin unit tests |
| `androidx.test:runner` / `androidx.test:core` / `androidx.test.ext:junit` | 1.6.2 / 1.6.1 / 1.2.1 | Device instrumentation test |

Gradle needs access to Google Maven, Maven Central and the Gradle Plugin Portal. On networks that block Maven Central, use an approved mirror as described in [Windows certificate trust and approved Maven mirror](#windows-certificate-trust-and-approved-maven-mirror).

### Optional backend libraries (`backend/requirements.txt`)

FastAPI 0.141.1, Uvicorn 0.53.0, SQLAlchemy 2.0.54, psycopg[binary] 3.3.5, Alembic 1.20.0, PyJWT 2.14.0, pwdlib[argon2] 0.3.1, Pydantic 2.13.5, pydantic-settings 2.15.0, email-validator 2.3.0, SlowAPI 0.1.10, HTTPX 0.28.1 and pytest 9.1.1.

### Set up a fresh clone

```powershell
git clone https://github.com/tufail-sandarwale/test-mock-app.git
cd test-mock-app
npm --prefix mobile ci

# Optional backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

If your pip is configured for user-wide installs, add `--no-user` to the pip install command inside the virtual environment. Then continue with [Installation and running](#installation-and-running) for the mobile app or [Optional backend](#optional-backend) for the API. The map needs internet access to load tiles; GPS simulation, saved locations and routes work offline.

### User-local SDK configuration

The Windows command-line tools (version 22.0) are installed at `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`. Their official download was checked against Google's published SHA-256 before extraction. No administrator privileges or Android Studio installer were required.

`ANDROID_HOME` is configured at user scope. The existing user PATH was preserved with `platform-tools` and `cmdline-tools\latest\bin` appended. Fully restart VS Code after installation so new integrated terminals inherit those settings. The project also has an ignored `mobile/android/local.properties` pointing to this SDK; do not commit that machine-specific file.

Google's current API 37 package ID is **`platforms;android-37.0`**, not `platforms;android-37`. The project's integer `compileSdkVersion = 37` is unchanged. The required package installation command is:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" `
	"--sdk_root=$env:LOCALAPPDATA\Android\Sdk" --install `
	'platform-tools' 'platforms;android-37.0' 'build-tools;37.0.0' `
	'ndk;27.1.12297006' 'cmake;3.22.1'
```

If Java reports certificate errors, temporarily set `JAVA_OPTS` to use the existing Windows trusted roots as shown in the Gradle troubleshooting section, then restore it after installation. Never use `--no_https` or disable certificate validation. Review each license prompt yourself; the current SDK license prompt was accepted only after explicit user authorization. `sdkmanager` 22.0 warns that it is deprecated in favor of `android sdk`, but the command above remains supported by the installed tools.

This configures build tools only. An emulator/system image or connected authorized phone is still needed to run the app; no emulator is installed by this command.

NDK 27.1.12297006 is now installed and verified. The SDK Manager download stalled, so the official `android-ndk-r27b-windows.zip` was downloaded directly from Google and its size and published repository checksum checked before extraction. The subsequent full Android build validated the installed toolchain.

## Installation and running

From the workspace root in PowerShell:

```powershell
cd mobile
npm ci
npm run typecheck
npm test -- --runInBand
npm run lint
npm start
```

In a second terminal with an emulator or authorized device running:

```powershell
cd mobile
adb devices
npm run android
```

Metro serves JavaScript to the native application, not a browser app. Android Studio can open `mobile/android`. The generated iOS template is unverified and outside this Android-only scope.

### Run the existing debug APK

The normal `npm run android` command does not automatically apply the optional corporate Maven mirror. On this machine, use the approved-mirror build command below when rebuilding, or install the already-built APK without rerunning Gradle.

Connect an authorized USB-debugging phone or start an emulator. From the workspace root, start Metro in one terminal:

```powershell
npm --prefix mobile start
```

In a second terminal at the workspace root, with exactly one device connected:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r .\mobile\android\app\build\outputs\apk\debug\app-debug.apk
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8081 tcp:8081
```

Open **Mock GPS Tester** on the device. Approve USB debugging on the phone if prompted. If multiple devices are attached, select the intended device with `adb -s SERIAL` for each command. The APK is debug-signed and requires Metro. Installation and launch have not yet been verified because no device was connected.

### Standalone test APK (no Expo or Metro)

**Download for phone testing:** [releases/mock-gps-tester-test-arm64.apk](https://github.com/tufail-sandarwale/test-mock-app/raw/main/releases/mock-gps-tester-test-arm64.apk) (about 37 MB, 64-bit ARM phones, Android 7.0+). Open the link on the phone, allow installation from your browser or file manager if prompted, then open **Mock GPS Tester**. It is development-signed for testing only; uninstall it before installing a build signed with a different key.

Build `:app:assembleStandalone` using the same Gradle command and approved-mirror flags documented below. This variant bundles JavaScript, Hermes and assets, uses release dependencies with developer support disabled, and is signed with the development key. Production release signing is unchanged. This is for private testing only, not store distribution.

Verified on 2026-09-19: standalone build passes, APK v2 signature verifies, bundled JavaScript and Hermes are present for arm64-v8a, armeabi-v7a, x86 and x86_64. Version `1.0-test`, minimum SDK 24, size approximately 114 MB. The custom variant explicitly disables cleartext traffic.

Rebuilt on 2026-10-21 for the GPS emulator redesign with `-PreactNativeArchitectures=arm64-v8a :app:assembleStandalone`, using JDK 17 (React Native's recommended version) from the Gradle toolchain cache at `%USERPROFILE%\.gradle\jdks`. The machine's default Java is now 27, which was not tested with this build. Rebuilt again on 2026-10-22 after a tester reported a blank white screen, adding the self-diagnosis features listed above and rendering the map with a TextureView. The arm64 APK is 37.2 MB, its v2 signature verifies with the development key, and the bundle and native code contain the new UI, crash recorder and map safe mode. The downloadable `releases/` APK is this build (SHA-256 `CBEA093EEFD8B4868159258F068700A9C629BB5D5F5290B324FB2DFBC861E8A2`).

Output: `mobile/android/app/build/outputs/apk/standalone/app-standalone.apk`. Transfer this APK to an Android 7.0+ phone, open it in the phone's file manager, and allow installation from that source if Android asks. Open **Mock GPS Tester** directly; no Expo, Metro, USB debugging or backend is required. Fresh map tiles still need internet. Optional cloud access requires an HTTPS server in this variant.

The standalone variant uses the same app ID and development signing key as the debug build, so it can replace that build while retaining saved presets. Device execution remains unverified until installed on a phone/emulator. Android mock-app selection and precise-location permission are still required for simulation.

### Test a location or route

1. Select this app as the mock app in Developer Options and enable device Location. If anything is missing, the map shows a **Device setup** banner with a **Fix** button.
2. Optional: press the target button (**Go to my real location**) before mocking. It captures a timestamped real snapshot, not a concurrent live real-GPS feed, and centers the map on it. Mock or stale readings are rejected; capture times out after 15 seconds.
3. **Location mode:** move the map so the red pin is on the place you want, search for a place, type `lat, lng` in the search bar, or use **Coordinates…** for full manual entry. Press the green play button. The button turns red; press it again to stop. While mocking, pan elsewhere and press **Move mock here** to jump without restarting.
4. **Route mode:** tap the map to add waypoints (or **+ Pin** for the pin location), pick Walk/Bike/Car or set any speed in Settings, toggle **Loop** if needed, and press play. Loop mode travels back to the first point instead of teleporting. **Save** stores the route under Saved Routes.
5. **Joystick mode:** pick a top speed, press play, then drag the joystick. Releasing it stops movement. Joystick control is available only while running; pausing freezes the position.
6. Use the star to save favorites, and **Set target here** (or long-press, **Set as radius target**) to draw the radius. Settings defaults to 100 m with an exclusive boundary; the bottom panel compares the mocked (or pin) location with the target.
7. The map's pause button and the Android notification pause/resume/stop. Pausing removes test providers and releases the wake lock; elapsed route time is frozen. Stopping removes the foreground notification and providers.

Map markers: red center pin = location to mock, blue dot = current mocked location, gray dot = captured real location, T = radius target, A/B = route start and end with orange waypoint dots. The native route uses WGS84 ellipsoidal geometry; Turf radius/distance uses a spherical geodesic approximation, so small differences can occur. Radius is an in-app comparison, not Android GeofencingClient registration. It does not infer another app's geofence result.

Settings apply to the next simulation, not an already running one; the route speed presets and Loop chip on the map change these settings. Interval is 200-10000 ms; duration is 0-86400 seconds. Zero duration uses a 24-hour safety cap. Routes require positive speed and 2-500 points. Speeds in Settings/routes are km/h; the location editor/native location API uses m/s. Bearing follows the route tangent during route playback and the joystick direction in joystick mode. Joystick positions advance at the configured update interval (use 200-500 ms for smoother movement). The service uses monotonic time and bounded scheduled updates; OEM battery restrictions may still stop it. There is no boot auto-start or hidden restart.

Coordinate entry (including typed coordinates in the search bar), persisted favorites, history, routes and simulation work without network. Fresh map tiles and place search need connectivity. Third-party services, all over HTTPS without keys:

- **Map styles:** Streets, Bright, Light and Dark use [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data) with attribution. Satellite uses [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) with the required Esri attribution; review [Esri's terms of use](https://goto.arcgisonline.com/maps/World_Imagery) before any distribution or commercial use.
- **Place search:** [OpenStreetMap Nominatim](https://nominatim.org). Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) allows at most 1 request per second, requires an identifying User-Agent, and forbids search-as-you-type. The app searches only when you submit, waits between requests, and identifies itself. For heavy or production use, host your own Nominatim or use a commercial geocoder.

MapLibre 11.2.0 renders the map. `npm ci` applies the committed one-line React Native 0.87 compatibility patch via `patch-package`. Review tile-provider terms and availability for deployment.

## Environment configuration

The mobile Cloud Presets screen accepts an optional server URL; the core app needs no backend configuration or map key. HTTPS is required except localhost, 127.0.0.1 and Android emulator 10.0.2.2 in debug builds. Tokens and passwords are not persisted. No API_BASE_URL or MAP_API_KEY build variable is consumed.

Workspace access rules prevented creating `.env.example`. Backend environment variable names and commands are documented below instead. Never commit real credentials, database files, environment files, or signing keys.

## Building APKs

After resolving the prerequisites:

```powershell
cd mobile/android
.\gradlew.bat :app:assembleDebug
```

Built artifact: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Debug installs need Metro. **The debug build succeeded and its APK signature verified on 2026-09-18.** The successful build used the Windows certificate trust and approved-mirror options documented below. It included arm64-v8a, armeabi-v7a, x86, and x86_64.

Release signing no longer falls back to the public debug key. Supply `MOCK_GPS_KEYSTORE` (absolute private keystore path), `MOCK_GPS_STORE_PASSWORD`, `MOCK_GPS_KEY_ALIAS`, and `MOCK_GPS_KEY_PASSWORD` through your local terminal or CI secrets, never chat or source control. Then run `./gradlew.bat :app:assembleRelease` in `mobile/android`; output is under `app/build/outputs/apk/release`. Release bundles JavaScript and does not need Metro. No private release key was created and no signed production release has been verified. Device tests, dependency remediation, and performance checks remain required before distribution.

## Blockers and troubleshooting

1. The Gradle download's `SSLHandshakeException` / `PKIX path building failed` was resolved using Java's `Windows-ROOT` trust-store provider. Windows already trusts the required certificate chain. Maven Central then returned HTTP 403 from Zscaler; using the existing approved Nexus mirror from the local Maven settings resolved the tested plugin dependencies. See the opt-in command below. No TLS checks were disabled and no certificates or global settings were modified.
2. The SDK path is now configured at user scope and in the project's ignored local properties. Platform 37.0, Build Tools 37.0.0, CMake 3.22.1, Platform-Tools 37.0.1, and NDK 27.1.12297006 are installed and the debug APK builds successfully. Android Studio/emulator remain uninstalled and no device is connected, so runtime validation is still blocked.
3. The final `npm audit --omit=dev` reports 28 advisories: 1 low, 5 moderate, 22 high, 0 critical. These include React Native, CLI/Metro chains and MapLibre. The earlier full development audit reported 49. Run `npm audit` and `npm audit --omit=dev` for current details. Do not blindly use `npm audit fix --force`; compatible remediation and retesting are release requirements. Metro also emits a dependency private-featureflags export warning while successfully bundling.
4. Select the workspace TypeScript version for editor diagnostics. For backend imports, select `.venv/Scripts/python.exe` using Python: Select Interpreter; the tests use this environment explicitly. The generated TypeScript configuration is inaccessible to Copilot under workspace rules; no compiler workaround was applied.
5. **Blank white screen on a phone (reported 2026-10-21, cause not yet confirmed).** The redesigned build opened to a white screen on a tester's phone; no device log was available. In React Native's new architecture, a fatal error in a release build can tear down React while the app stays open, which leaves exactly this white screen. The current APK guards against every likely cause it can: on-screen error reporting, crash reports saved for the next launch, map safe mode, TextureView map rendering, validated map events, whole-number native ornament props and a startup timeout. If a phone still shows a problem:
   - Swipe the app away from Recent apps and open it again. If the map caused the failure, it now opens in **Map paused** mode; if anything crashed, a report appears that you can send with **Share report**.
   - If an error screen appears, use **Share details** (or take a screenshot) and send it to the developer.
   - With a USB cable and USB debugging, `adb logcat "*:E"` shows the errors from the device log.

For device discovery, check `adb devices`, USB authorization, and emulator startup. Android compilation is verified; device execution, screenshots, rotation/process restoration, and accessibility on real hardware remain unverified. The successful build emits dependency/template deprecation warnings, including APIs scheduled for removal in Gradle/AGP 10; do not upgrade that toolchain without compatibility testing.

### Windows certificate trust and approved Maven mirror

The optional `mobile/android/gradle/approved-mirror.init.gradle` redirects Maven Central repositories to an explicitly provided approved HTTPS mirror and makes it available for plugin dependencies. Google Maven and the Gradle Plugin Portal remain available for their specialized artifacts. Normal builds are unchanged unless you supply `-I`. The URL must not contain credentials, query parameters, or fragments.

The tested mirror was already configured in this machine's `%USERPROFILE%\.m2\settings.xml`. Gradle does not automatically use Maven's mirror configuration. Use that approved URL, or ask your administrator for one; do not substitute arbitrary mirrors or bypass corporate network policy.

From the workspace root, replace the placeholder below with your approved mirror URL:

```powershell
$approvedMirror = 'https://YOUR-APPROVED-MIRROR/repository/maven-public/'
$originalJavaOpts = $env:JAVA_OPTS
try {
	$env:JAVA_OPTS = "$originalJavaOpts -Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE"
	.\mobile\android\gradlew.bat -p .\mobile\android `
		-I "$PWD\mobile\android\gradle\approved-mirror.init.gradle" `
		'-Djavax.net.ssl.trustStoreType=Windows-ROOT' `
		'-Djavax.net.ssl.trustStore=NONE' `
		"-Dmockgpstester.mavenMirror=$approvedMirror" `
		:app:assembleDebug --no-daemon --console=plain
} finally {
	$env:JAVA_OPTS = $originalJavaOpts
}
```

`JAVA_OPTS` covers a fresh wrapper download; explicit `-D` options cover Gradle's build process. `NONE` selects a non-file trust store, not disabled verification. Java still validates certificate chains against existing Windows trusted roots. No global Java configuration is changed. On a machine where Windows does not trust the required CA, obtain approved administrator assistance instead of disabling verification. This Windows-specific command must not be copied unchanged to other operating systems.

The SDK directory and required tools are now installed. The command above completed `:app:assembleDebug` successfully in 17m 48s on the first full build (113 tasks). The debug APK exists and its signature verifies. Device installation and execution remain unverified.

## Architecture and phases

Core path: `React Native UI -> typed Kotlin module -> MockLocationService -> LocationManager test providers`. The native bridge uses RN's legacy-module interop in the new-architecture template. The native service is the authority for simulation status. Only selections/settings/presets persist in JS, never an assumption that simulation is still running.

- `mobile/src/screens`, `components`, `navigation`: presentation and typed navigation. `EmulatorScreen.tsx` is the map-first home screen; `components/` holds the center pin, joystick, round controls, side drawer, bottom sheet and name prompt (icons are drawn with views, so no icon font or extra native dependency is needed).
- `mobile/src/services`, `store`, `utils`, `types`: permissions/bridge, place search (`geocoding.ts`), local and cloud state, preferences (map style, joystick speed), validation, geometry, joystick math, map styles, models.
- `mobile/android/app/src/main/java/com/mockgpstester/mocklocation`: bridge, foreground service, status, WGS84 engine. Joystick input (`steer`) and teleport (`moveTo`) reach the running service as intents; the engine integrates steering geodesically and stops it after 3 s without updates.
- `backend/app`: configuration, models, schemas, repository, API, and application factory.
- `backend/migrations`: explicit schema history; no automatic production table creation.

Phases 1-8 are implemented with automated checks and Android builds. Phase 9 has backend/client tests and PostgreSQL-compatible migrations; a live PostgreSQL run is pending. Phase 10 includes automated tests and a compiled device integration test; real-device behavior, performance, dependency security remediation, and release signing remain unverified. Device gates were deferred only with explicit user authorization.

## Optional backend

Requires Python 3.13 (tested), PostgreSQL, and a database/user you control. Production uses a least-privilege database account and HTTPS. SQLite is supported for local development/tests only.

From the workspace root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --no-user -r backend/requirements.txt
$env:MOCK_GPS_DATABASE_URL = 'postgresql+psycopg://USER:PASSWORD@localhost:5432/mock_gps'
$secretBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($secretBytes)
$random.Dispose()
$env:MOCK_GPS_JWT_SECRET = [Convert]::ToBase64String($secretBytes)
.\.venv\Scripts\python.exe -m alembic -c backend/alembic.ini upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

The command generates a secret without printing it. It lasts only for that shell session; changing it invalidates prior tokens. For deployment, supply a stable cryptographically random secret through a secrets manager; do not reuse test keys. Environment variables can also come from a private `.env` in the process working directory. Pydantic settings use the `MOCK_GPS_` prefix; database URL and JWT secret are required. `MOCK_GPS_TOKEN_MINUTES` defaults to 30. `MOCK_GPS_RATE_LIMIT_STORAGE_URI` defaults to `memory://` for one process; use a supported shared limits backend plus its driver for multi-worker production rate limiting.

For local development without PostgreSQL, set `MOCK_GPS_DATABASE_URL=sqlite:///./backend/local.db` before migrations. API docs: `http://127.0.0.1:8000/docs`; health: `/health`. The health endpoint is liveness, not database readiness. For USB-connected debug phones run `adb reverse tcp:8000 tcp:8000`, then enter `http://127.0.0.1:8000` in Cloud Presets. The Android emulator uses `http://10.0.2.2:8000`. Do not send production credentials over HTTP.

### API

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`: JSON `{ "email": "...", "password": "..." }`; passwords 12-128 characters; Bearer JWT response.
- `GET/POST /api/v1/locations`, `GET/PUT/DELETE /api/v1/locations/{id}`.
- `GET/POST /api/v1/routes`, `GET/PUT/DELETE /api/v1/routes/{id}`.
- Collections accept `offset` and `limit` (1-100). Each token can access only its owner's records; inaccessible IDs return 404.
- Location fields: name, latitude, longitude, accuracy, altitude, bearing, speed (m/s).
- Route fields: name, points (2-500 latitude/longitude pairs), speedKmh. IDs and creation/update timestamps are server-managed.
- Registration/login limits are 5/10 per minute per remote address. Other routes use a default 120/minute per address. Configure trusted reverse proxies, shared limiter storage, ingress body-size limits and TLS before deployment. Do not trust arbitrary forwarded IP headers.

Cloud upload/download creates new copies and may create duplicates when repeated. It is not automatic bidirectional sync, and there is no merge/conflict resolution or refresh token. Sign in again after expiration/restart. Local edits do not change existing cloud records; the API supports PUT for explicit updates. No profile/password-reset feature is claimed. Presets are stored in app-private AsyncStorage, not encrypted storage; cloud databases/backups need deployment encryption and access controls.

### Tests

```powershell
npm --prefix mobile run typecheck
npm --prefix mobile run lint
npm --prefix mobile test -- --runInBand
.\.venv\Scripts\python.exe -m pytest -c backend/pytest.ini backend/tests -q
.\mobile\android\gradlew.bat -p mobile/android :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
```

Use the approved-mirror flags above on this network. Backend tests isolate SQLite databases, exercise authentication/ownership and migrate up/down; PostgreSQL SQL generation is checked but does not substitute for a live PostgreSQL test.

The compiled `MockLocationServiceTest` is opt-in: manually select this app as the mock app, grant precise location, enable Location, and stop current simulation first. With a device connected, run `:app:connectedDebugAndroidTest` using the same build flags. It tests actual GPS mock readings and start/pause/resume/stop, and skips when prerequisites are absent; a skipped test is not a pass. It never changes Developer Options or AppOps for you.

## Device and release checklist

- Verify map tap/long-press, center pin accuracy, place search and typed coordinates, map style switching (including satellite), offline manual entry, overlays, rotation, font scaling and both themes on small/large devices.
- Verify joystick steering direction on rotated maps, release/backgrounding stops movement, Move mock here, camera follow, route drawing/undo/loop, and favorites/history.
- Verify permission denied/approximate-only, services off, wrong mock app, notification denied, and recovery after permission revocation.
- Observe mock readings in your authorized test app, status events, pause freezing route time, foreground notification actions, and restoration of non-mock readings after stop/completion.
- Verify background/screen-off behavior, unexpected process death, reopening/recovery, and OEM battery restrictions. Last readings can remain cached by clients; clients must check timestamps/mock flags.
- Check boundary distances just below/at/above 100 m, varied route speeds, zero-length segments, loop return legs, duration completion, persistence and storage failure handling.
- Profile CPU, memory, battery and UI responsiveness at 200 ms and 1000 ms intervals, long routes and background operation. No performance measurements are claimed yet.
- Run live PostgreSQL migrations/API tests, review dependency audits, configure production TLS/rate limiting/backups, and sign using your private upload key before distribution.