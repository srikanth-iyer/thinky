"""scripts/android_overlay.py on a stand-in for `tauri android init`'s output (no Android SDK needed):
both shapes, the downloadable APK and the Google Play bundle (THINKY_PLAY=1). Checks that the Play
version keeps none of the updater (the outside review's claim 10a: its code, the permission, the
receiver), that the APK keeps all of it, and the manifest's other settings (no Android backup, the
pop-up kept as it is when the phone turns). With a Kotlin compiler around (android/test/run.sh finds
one the same way), both MainActivity.kt files are also checked for syntax errors (names from Android
and Tauri can't be looked up here, so only the syntax is checked). Run: python3 android/test/overlay_test.py
"""
import os, re, shutil, subprocess, sys, tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PKG_DIR = "src-tauri/gen/android/app/src/main/java/com/srikanth/leanoutliner"
GEN_ACTIVITY = """package com.srikanth.leanoutliner

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
"""
GEN_MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.lean_outliner"
        android:allowBackup="true"
        android:usesCleartextTraffic="${usesCleartextTraffic}">
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:launchMode="singleTask"
            android:label="@string/main_activity_title"
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"""
THEMES = """<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.lean_outliner" parent="Theme.MaterialComponents.DayNight.NoActionBar">
    </style>
</resources>
"""

failed = 0


def check(what, ok):
    global failed
    print(("PASS " if ok else "FAIL ") + what)
    if not ok:
        failed += 1


def make_tree(root):
    for d in ("android", "scripts"):
        shutil.copytree(os.path.join(REPO, d), os.path.join(root, d))
    os.makedirs(os.path.join(root, "src-tauri/src"))
    shutil.copy(os.path.join(REPO, "src-tauri/Cargo.toml"), os.path.join(root, "src-tauri"))
    shutil.copy(os.path.join(REPO, "src-tauri/src/android_capture.rs"), os.path.join(root, "src-tauri/src"))
    if os.path.isdir(os.path.join(REPO, "src-tauri/icons/android")):
        shutil.copytree(os.path.join(REPO, "src-tauri/icons/android"), os.path.join(root, "src-tauri/icons/android"))
    os.makedirs(os.path.join(root, PKG_DIR))
    open(os.path.join(root, PKG_DIR, "MainActivity.kt"), "w").write(GEN_ACTIVITY)
    main = os.path.join(root, "src-tauri/gen/android/app/src/main")
    open(os.path.join(main, "AndroidManifest.xml"), "w").write(GEN_MANIFEST)
    os.makedirs(os.path.join(main, "res/values"))
    open(os.path.join(main, "res/values/themes.xml"), "w").write(THEMES)


TEST_KEY = "GujNI3y9EL2II7ODeal1Npt7J82Fnpclbsh8TiJmf8L+zsL+2wqRHDMc95BPM59ERcb8vf65V7SN8GcspvjpjQ=="


def overlay(play, key=TEST_KEY):
    root = tempfile.mkdtemp(prefix="overlay-test-")
    make_tree(root)
    env = dict(os.environ)
    env.pop("THINKY_PLAY", None)
    env.pop("LEAN_UPDATE_KEY", None)
    if key is not None:
        env["LEAN_UPDATE_KEY"] = key
    if play:
        env["THINKY_PLAY"] = "1"
    r = subprocess.run([sys.executable, "scripts/android_overlay.py"], cwd=root, env=env, capture_output=True, text=True)
    check(f"the overlay runs ({'Play' if play else 'APK'}): {r.stderr.strip()[-300:]}", r.returncode == 0)
    act = open(os.path.join(root, PKG_DIR, "MainActivity.kt")).read()
    man = open(os.path.join(root, "src-tauri/gen/android/app/src/main/AndroidManifest.xml")).read()
    # running it twice changes nothing (it's run again to switch shapes)
    r2 = subprocess.run([sys.executable, "scripts/android_overlay.py"], cwd=root, env=env, capture_output=True, text=True)
    man2 = open(os.path.join(root, "src-tauri/gen/android/app/src/main/AndroidManifest.xml")).read()
    check(f"a second run keeps the same manifest ({'Play' if play else 'APK'})", r2.returncode == 0 and man2 == man)
    return root, act, man


def kotlin_syntax_errors(paths):
    """Syntax errors in Kotlin files compiled together (None when no compiler is around)."""
    kotlinc = shutil.which("kotlinc")
    libs = [d for d in [os.path.join(os.environ.get("GRADLE_HOME", "/nonexistent"), "lib")] + sorted(
        os.path.join("/opt", x, "lib") for x in (os.listdir("/opt") if os.path.isdir("/opt") else []) if x.startswith("gradle")) if os.path.isdir(d)]
    if kotlinc:
        cmd = [kotlinc]
    elif libs:
        jars = os.listdir(libs[0])
        jar = lambda n: next((os.path.join(libs[0], j) for j in jars if re.match(re.escape(n) + r"-[0-9]", j)), "")
        cp = ":".join(jar(n) for n in ("kotlin-compiler-embeddable", "kotlin-stdlib", "kotlin-script-runtime", "kotlin-reflect",
                                       "trove4j", "kotlinx-coroutines-core-jvm", "annotations", "kotlin-daemon-embeddable"))
        cmd = ["java", "-cp", cp, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect", "-cp", jar("kotlin-stdlib")]
    else:
        return None
    out = tempfile.mkdtemp(prefix="overlay-kt-")
    r = subprocess.run(cmd + list(paths) + ["-d", out], capture_output=True, text=True)
    # (names from Android, AndroidX and Tauri aren't here: only the compiler's syntax errors count)
    return [l for l in r.stderr.splitlines() if ": error: syntax error" in l]


def main():
    apk_root, apk, apk_man = overlay(play=False)
    play_root, play, play_man = overlay(play=True)
    # the downloadable APK: the whole updater
    for word in ("fun startUpdate", "fun installUpdate", "fun downloadUpdate", "class UpdateReceiver", "releases/download",
                 "PackageInstaller.SessionParams", "fun testInstallSelf", "fun signedLikeThisApp", "fun onResume",
                 "Checks.apkSigProblem(key, sig", "Checks.APK_SIG_FILE"):
        check(f"the APK keeps {word!r}", word in apk)
    check("the APK may install updates", "REQUEST_INSTALL_PACKAGES" in apk_man and ".UpdateReceiver" in apk_man)
    check("the APK isn't the Play version", "const val PLAY = false" in apk)
    # the update key's public half is written in (the APK checks each update's signature file with it)
    check("the APK holds the update key", f'private val UPDATE_KEY = "{TEST_KEY}"' in apk and "__UPDATE_KEY__" not in apk)
    no_root, no_key, _ = overlay(play=False, key=None)
    check("without LEAN_UPDATE_KEY the key is empty (every update refused)", 'private val UPDATE_KEY = ""' in no_key)
    shutil.rmtree(no_root, ignore_errors=True)
    for bad in ("not-base64!", TEST_KEY[:-4], TEST_KEY + "AAAA", "A" * 88):
        r = tempfile.mkdtemp(prefix="overlay-test-")
        make_tree(r)
        env = {k: v for k, v in os.environ.items() if k != "THINKY_PLAY"}
        env["LEAN_UPDATE_KEY"] = bad
        p = subprocess.run([sys.executable, "scripts/android_overlay.py"], cwd=r, env=env, capture_output=True, text=True)
        check(f"a wrong LEAN_UPDATE_KEY ({bad[:10]}…) stops the build", p.returncode != 0 and "LEAN_UPDATE_KEY" in p.stderr)
        shutil.rmtree(r, ignore_errors=True)
    # the Play bundle: none of it (claim 10a), the rest as in the APK
    for word in ("startUpdate", "installUpdate", "downloadUpdate", "UpdateReceiver", "releases/download", "PackageInstaller",
                 "testInstallSelf", "signedLikeThisApp", "keepUpdateTag", "github.com", "UPDATE_KEY", TEST_KEY, "apkSigProblem", "fun onResume", "import android.app.PendingIntent",
                 "import java.net.HttpURLConnection"):
        check(f"the Play version has no {word!r}", word not in play)
    check("the Play version may not install apps", "REQUEST_INSTALL_PACKAGES" not in play_man and "UpdateReceiver" not in play_man)
    check("the Play version says so", "const val PLAY = true" in play and "fun fromPlay(): Boolean = PLAY" in play)
    for word in ("fun aiKeySetFor", "fun aiSend", "fun setWidgetColors", "fun testWidgetText", "fun takeShortcut", "class Bridge",
                 "import android.content.Context", "import org.json.JSONObject"):
        check(f"the Play version keeps {word!r}", word in play)
    check("the Play version keeps the bridge's braces balanced", play.count("{") == play.count("}"))
    check("the APK's braces balanced", apk.count("{") == apk.count("}"))
    # both: no Android backup of the app's settings; the pop-up kept as it is when the phone turns
    for name, man in (("APK", apk_man), ("Play", play_man)):
        check(f"{name}: no Android backup", 'android:allowBackup="false"' in man and 'android:allowBackup="true"' not in man)
        check(f"{name}: one allowBackup", man.count("android:allowBackup") == 1)
        qc = re.search(r'<activity android:name="\.QuickCaptureActivity"[^>]*>', man)
        check(f"{name}: the pop-up stays as it is when the phone turns", bool(qc) and "orientation|screenSize" in qc.group(0))
        sel = re.search(r'<activity android:name="\.SelectionCaptureActivity"[^>]*>', man)
        check(f"{name}: Add to thinky only for selected text", bool(sel) and "PROCESS_TEXT" in man)
    # every Kotlin file of ours got the package line; Checks.kt (the plain rules) is copied in too
    for kt in ("Checks.kt", "AiKeys.kt", "JournalWidget.kt", "QuickCaptureActivity.kt", "SelectionCaptureActivity.kt", "LeanCore.kt"):
        src = open(os.path.join(play_root, PKG_DIR, kt)).read()
        check(f"{kt} copied with its package", src.startswith("package com.srikanth.leanoutliner\n"))
    check("the tests aren't copied into the app", not os.path.exists(os.path.join(play_root, PKG_DIR, "ChecksTest.kt")))
    for name, root in (("APK", apk_root), ("Play", play_root)):
        kts = sorted(os.path.join(root, PKG_DIR, f) for f in os.listdir(os.path.join(root, PKG_DIR)) if f.endswith(".kt"))
        errs = kotlin_syntax_errors(kts)
        if errs is None:
            print("SKIPPED the Kotlin syntax check: no Kotlin compiler here")
            break
        check(f"{name}: the Kotlin files ({len(kts)}) have no syntax errors {errs[:3]}", not errs and len(kts) >= 8)
    for root in (apk_root, play_root):
        shutil.rmtree(root, ignore_errors=True)
    print("overlay_test:", "everything passed" if not failed else f"{failed} FAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
