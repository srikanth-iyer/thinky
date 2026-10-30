"""Apply our Android customisations on top of `tauri android init` output.

Run from the repo root after init. Idempotent. Touches only src-tauri/gen/android.
- MainActivity.kt: replaced by android/MainActivity.kt (keeps the generated package + imports)
- android/kotlin/*.kt and android/res: widgets, quick capture pop-up (LeanCore.kt: the Rust
  library's name filled in, the JNI name checked), Quick Settings tile
- AndroidManifest.xml: storage permissions for the Drive Sync folder; the widgets, the pop-up
  and the tile (COMPONENTS); one-click updates (permission to install apps, UpdateReceiver);
  leanoutliner:// links (a VIEW filter on MainActivity). The app icon's shortcuts need nothing
  here (MainActivity sets them)
- launcher icons: copied from src-tauri/icons/android
- the start-up screen (themes): the brand's cream from the first moment, no icon on Android's own
  splash (the app's start-up drawing comes right after it), so nothing dark flashes first
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
# LeanCore.kt loads the app's Rust library (its [lib] name in src-tauri/Cargo.toml, which Tauri
# builds as lib<name>.so) and calls src-tauri/src/android_capture.rs, whose JNI function's name
# carries the package and class: they must match, or the "Add a note" pop-up couldn't add anything.
lib = re.search(r'^\[lib\][^\[]*?^name\s*=\s*"([\w-]+)"', open("src-tauri/Cargo.toml").read(), re.M | re.S).group(1)
jni = "Java_" + pkg.replace("_", "_1").replace(".", "_") + "_LeanCore_capture"
if jni not in open("src-tauri/src/android_capture.rs").read():
    sys.exit(f"src-tauri/src/android_capture.rs has no {jni}: the package is {pkg}")
src_dir = os.path.dirname(acts[0])
for kt in glob.glob("android/kotlin/*.kt"):
    code = open(kt).read().replace("__RUST_LIB__", lib)
    open(os.path.join(src_dir, os.path.basename(kt)), "w").write(f"package {pkg}\n\n{code}")
    print("Kotlin ->", os.path.basename(kt))
print("Rust library for the pop-up:", lib, "JNI:", jni)
# release builds shrink the Kotlin code (R8): keep LeanCore's native method and its name
pro = f"{GEN}/app/proguard-rules.pro"
keep = f"-keep class {pkg}.LeanCore {{ *; }}"
if keep not in (open(pro).read() if os.path.exists(pro) else ""):
    with open(pro, "a") as f:
        f.write(f"\n# the \"Add a note\" pop-up calls the app's Rust code through this (android_capture.rs)\n{keep}\n")

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
# leanoutliner://page/… and …/note/… links (the app's "Copy link") open the app at that page:
# Android hands them to MainActivity (takeIntent; already open: onNewIntent, as it's singleTask)
LINKS = """    <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="leanoutliner" />
            </intent-filter>
        """
if 'android:scheme="leanoutliner"' not in man:
    m = re.search(r'<activity\b[^>]*android:name="\.MainActivity"[^>]*?(/?)>', man)
    if not m:
        sys.exit("MainActivity not found in the manifest")
    if m.group(1):  # <activity … /> : give it a body
        man = man[:m.start()] + m.group(0)[:-2].rstrip() + ">\n        " + LINKS + "</activity>" + man[m.end():]
    else:
        i = man.index("</activity>", m.end())
        man = man[:i] + LINKS + man[i:]
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

# --- Start-up colours (Build 33, he asked: no dark screen, then cream, then the drawing; straight to
# the logo on cream). Android's own splash (12+) and the window behind the app are the brand's cream
# #F4EEE3 with no icon on them (lean_blank), so the page's #splash, which draws the scribble on the
# same cream, follows without a jump. Every app theme in values*/themes.xml gets the items.
os.makedirs(f"{res}/values", exist_ok=True)
open(f"{res}/values/lean_start.xml", "w").write('''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="lean_start">#F4EEE3</color>
</resources>
''')
os.makedirs(f"{res}/drawable", exist_ok=True)
open(f"{res}/drawable/lean_blank.xml", "w").write('''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@android:color/transparent" />
    <size android:width="1dp" android:height="1dp" />
</shape>
''')
START_ITEMS = ('<item name="android:windowBackground">@color/lean_start</item>'
               '<item name="android:windowSplashScreenBackground">@color/lean_start</item>'
               '<item name="android:windowSplashScreenAnimatedIcon">@drawable/lean_blank</item>')
patched = 0
for f in glob.glob(f"{res}/values*/themes.xml"):
    xml = open(f).read()
    if "lean_start" in xml:
        patched += 1
        continue
    # each app theme (not the pop-up's dialog theme, which comes from AppCompat itself)
    new, n = re.subn(r'(<style\s+name="Theme\.[^"]*"[^>]*>)', lambda m: m.group(1) + START_ITEMS, xml)
    if n:
        open(f, "w").write(new)
        patched += n
        print("Start-up colours ->", f, n)
if not patched:
    sys.exit("no app theme found in values*/themes.xml for the start-up colours")
