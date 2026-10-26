"""Apply our Android customisations on top of `tauri android init` output.

Run from the repo root after init. Idempotent. Touches only src-tauri/gen/android.
- MainActivity.kt: replaced by android/MainActivity.kt (keeps the generated package + imports)
- android/kotlin/*.kt and android/res: widgets, quick capture pop-up, Quick Settings tile
- AndroidManifest.xml: storage permissions for the Drive Sync folder; the widgets, the pop-up
  and the tile (COMPONENTS); one-click updates (permission to install apps, UpdateReceiver).
  The app icon's shortcuts need nothing here (MainActivity sets them)
- launcher icons: copied from src-tauri/icons/android
"""
import glob, os, re, shutil, sys

GEN = "src-tauri/gen/android"
if not os.path.isdir(GEN):
    sys.exit("run `tauri android init` first")

# --- MainActivity
acts = glob.glob(f"{GEN}/app/src/main/java/**/MainActivity.kt", recursive=True)
if len(acts) != 1:
    sys.exit(f"expected one MainActivity.kt, found {acts}")
gen_src = open(acts[0]).read()
pkg = re.search(r"^package\s+([\w.]+)", gen_src, re.M).group(1)
gen_imports = re.findall(r"^import\s+[\w.]+", gen_src, re.M)
ours = open("android/MainActivity.kt").read()
our_imports = re.findall(r"^import\s+[\w.]+", ours, re.M)
body = re.sub(r"^(//.*\n)*", "", ours, count=1)
body = re.sub(r"^import\s+[\w.]+\s*\n", "", body, flags=re.M).lstrip()
edge = "enableEdgeToEdge()" if "enableEdgeToEdge" in gen_src else ""
body = body.replace("__EDGE__", edge)
imports = sorted(set(gen_imports) | set(our_imports))
open(acts[0], "w").write(f"package {pkg}\n\n" + "\n".join(imports) + "\n\n" + body)
print("MainActivity ->", acts[0], "package", pkg)

# --- extra Kotlin (widget, quick capture): same package as MainActivity
src_dir = os.path.dirname(acts[0])
for kt in glob.glob("android/kotlin/*.kt"):
    code = open(kt).read()
    open(os.path.join(src_dir, os.path.basename(kt)), "w").write(f"package {pkg}\n\n{code}")
    print("Kotlin ->", os.path.basename(kt))

# --- extra resources (layouts, widget info, drawables)
for f in glob.glob("android/res/**/*", recursive=True):
    if os.path.isfile(f):
        dst = os.path.join(f"{GEN}/app/src/main/res", os.path.relpath(f, "android/res"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy(f, dst)
print("Resources copied")

# --- Manifest
man_path = f"{GEN}/app/src/main/AndroidManifest.xml"
man = open(man_path).read()
if "xmlns:tools" not in man:
    man = man.replace("<manifest ", '<manifest xmlns:tools="http://schemas.android.com/tools" ', 1)
perms = [
    '<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" tools:ignore="ScopedStorage" />',
    '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" tools:ignore="ScopedStorage" />',
    # a short buzz when a swipe moves a note or a press-and-hold shows a preview (granted without asking)
    '<uses-permission android:name="android.permission.VIBRATE" />',
    # one-click updates: download the new APK and hand it to Android's installer (Android asks him
    # once to allow "Install unknown apps" for the app, and confirms each update)
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />',
]
missing = [p for p in perms if p.split('"')[1] not in man]
if missing:
    man = re.sub(r"(<manifest[^>]*>)", lambda m: m.group(1) + "\n    " + "\n    ".join(missing), man, count=1)
COMPONENTS = """
        <receiver android:name=".JournalWidget" android:exported="false" android:label="Today's journal">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/journal_widget_info" />
        </receiver>
        <service android:name=".JournalWidgetService" android:permission="android.permission.BIND_REMOTEVIEWS" android:exported="false" />
        <!-- no EmojiCompat start-up: it ties the app to Google Play services' font provider, and
             Android closes the app whenever that restarts (system fonts show emoji anyway) -->
        <provider android:name="androidx.startup.InitializationProvider" android:authorities="${applicationId}.androidx-startup"
            android:exported="false" tools:node="merge">
            <meta-data android:name="androidx.emoji2.text.EmojiCompatInitializer" tools:node="remove" />
        </provider>
        <receiver android:name=".QuickAddWidget" android:exported="false" android:label="Add a note">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/quick_add_widget_info" />
        </receiver>
        <activity android:name=".QuickCaptureActivity" android:exported="true" android:label="Add to journal"
            android:theme="@style/Theme.AppCompat.DayNight.Dialog" android:excludeFromRecents="true" android:taskAffinity=""
            android:windowSoftInputMode="stateVisible|adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
                <data android:mimeType="image/*" />
            </intent-filter>
        </activity>
        <service android:name=".AddNoteTile" android:exported="true" android:label="Add note"
            android:icon="@drawable/tile_add_note" android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
            <intent-filter><action android:name="android.service.quicksettings.action.QS_TILE" /></intent-filter>
        </service>
"""
if ".JournalWidget" not in man:
    i = man.rindex("</application>")
    man = man[:i] + COMPONENTS + "    " + man[i:]
# Android's installer reports how an update went (MainActivity.kt); not exported, so only Android,
# through the app's own PendingIntent, can reach it
if ".UpdateReceiver" not in man:
    i = man.rindex("</application>")
    man = man[:i] + '    <receiver android:name=".UpdateReceiver" android:exported="false" />\n    ' + man[i:]
if "requestLegacyExternalStorage" not in man:
    man = man.replace("<application", '<application android:requestLegacyExternalStorage="true"', 1)
open(man_path, "w").write(man)
print("Manifest patched")

# --- Icons
res = f"{GEN}/app/src/main/res"
for d in glob.glob("src-tauri/icons/android/*"):
    dst = os.path.join(res, os.path.basename(d))
    os.makedirs(dst, exist_ok=True)
    for f in glob.glob(f"{d}/*"):
        shutil.copy(f, dst)
print("Icons copied")
