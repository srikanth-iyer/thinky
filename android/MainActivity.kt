// Replaces the MainActivity that `tauri android init` generates (see scripts/android_overlay.py).
// Adds: system-bar/keyboard insets, "All files access" for the Drive Sync folder,
// a small JS bridge (window.LeanAndroid): file access, the widget and quick capture
// settings, printing, the look's colours for the status and navigation bars, leaving
// the app (Android's Back at the start; the app handles Back itself, see App.onBack), and
// one-click updates (update / installUpdate, with UpdateReceiver at the end of this file);
// and the long-press shortcuts on the app icon (Today, Add note, Search); leanoutliner://page/… and
// …/note/… links (the manifest's VIEW filter, scripts/android_overlay.py) open the app at that page.

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.Settings
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.pm.PackageInfoCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject

class MainActivity : TauriActivity() {
  companion object {
    const val OPEN = "open" // the shortcuts' extra: "today" or "search"
    /** The app's window, for UpdateReceiver to report to. */
    @Volatile var live: WeakReference<MainActivity>? = null
  }
  private var web: WebView? = null
  // Android 7–10 ask for file access with a dialog over the app: the app never leaves the screen, so
  // the page can't notice the answer by coming back to it. Tell it when the answer comes (App.start).
  private val askFiles = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
    web?.evaluateJavascript("document.dispatchEvent(new Event('lean-access'))", null)
  }
  /** What a shortcut on the app icon asked for, kept until the page takes it (LeanAndroid.takeShortcut). */
  private val shortcut = AtomicReference<String?>(null)
  private var keyboardWanted = false

  override fun onCreate(savedInstanceState: Bundle?) {
    __EDGE__
    super.onCreate(savedInstanceState)
    live = WeakReference(this)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
    // No automatic jump to Android's settings: the app explains why it needs access and offers a button.
    // The strips at the top and bottom take the look's colour; the last one is remembered, so it's
    // right from the first moment
    // until the page paints: all of it the brand's cream, bars too (he asked, Oct 30: no white or dark
    // screen first); the page then gives the look's colours (setBarColors, remembered for next time)
    paintBars(0xFFF4EEE3.toInt(), true)
    // started from a shortcut (but not when Android reopens an earlier visit, which repeats its request)
    if (savedInstanceState == null && (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) takeIntent(intent)
    if (Build.VERSION.SDK_INT >= 25) Thread { publishShortcuts() }.start()
  }

  /** Already running: a shortcut arrives here, and the page is told at once (it takes it when ready). */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (takeIntent(intent)) web?.evaluateJavascript("window.leanApp?.openShortcut?.()", null)
  }

  private fun takeIntent(i: Intent?): Boolean {
    // a leanoutliner://page/… or …/note/… link (the manifest's VIEW filter): the page opens it
    // (App.openShortcut → App.openLink), kept the same way as a shortcut's pick
    if (i != null && i.action == Intent.ACTION_VIEW && i.data?.scheme.equals("leanoutliner", ignoreCase = true)) {
      shortcut.set(i.dataString ?: return false)
      return true
    }
    val kind = i?.getStringExtra(OPEN) ?: return false
    shortcut.set(kind)
    return true
  }

  /** The menu that a long press on the app icon shows. Set at every start (one quick call to Android,
   *  off the main thread), and built from the running app, so it always points at this app. Not in
   *  the manifest: Android starts manifest shortcuts in a fresh task, which would restart the app
   *  while it's open; these reach the open app through onNewIntent. */
  @TargetApi(25)
  private fun publishShortcuts() {
    fun item(id: String, label: String, icon: Int, rank: Int, intent: Intent) = ShortcutInfo.Builder(this, id)
      .setShortLabel(label).setIcon(Icon.createWithResource(this, icon)).setRank(rank)
      .setIntent(intent.setAction(Intent.ACTION_MAIN)).build()
    // the open app gets it in onNewIntent (as Tauri's singleTask already does; this keeps it so)
    fun inApp(kind: String) = Intent(this, MainActivity::class.java).putExtra(OPEN, kind)
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    try {
      getSystemService(ShortcutManager::class.java)?.setDynamicShortcuts(listOf(
        item("today", "Today", R.drawable.sc_today, 0, inApp("today")),
        item("add", "Add note", R.drawable.sc_add_note, 1, Intent(this, QuickCaptureActivity::class.java)),
        item("search", "Search", R.drawable.sc_search, 2, inApp("search")),
      ))
    } catch (e: Exception) { } // e.g. too many changes in a day: the menu stays as it was
  }

  /** The keyboard for the box the page has just put the cursor in: Android shows it by itself only
   *  after a tap, and not before this window is in front (just opened from a shortcut), so then it
   *  waits for onWindowFocusChanged. */
  private fun showKeyboard() {
    val w = web ?: return
    keyboardWanted = !hasWindowFocus()
    if (keyboardWanted) return
    w.requestFocus()
    (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(w, 0)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && keyboardWanted) web?.postDelayed({ showKeyboard() }, 100)
  }

  /** Colour behind the status bar (clock, battery) and the navigation bar, with dark icons on a
   *  light colour and light icons on a dark one. The app draws behind the bars (edge to edge), so
   *  what shows there is this view's background; the window's own bar colours cover older phones. */
  fun paintBars(color: Int, light: Boolean) {
    findViewById<View>(android.R.id.content)?.setBackgroundColor(color)
    @Suppress("DEPRECATION") window.statusBarColor = color
    @Suppress("DEPRECATION") window.navigationBarColor = color
    val bars = WindowCompat.getInsetsController(window, window.decorView)
    bars.isAppearanceLightStatusBars = light
    bars.isAppearanceLightNavigationBars = light
  }

  fun hasAllFiles(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

  fun openAllFilesSettings() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // some phones lack one screen or the other: try the app's own, then the list, then app info
      val tries = listOf(
        Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")),
        Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")),
      )
      for (i in tries) {
        try { startActivity(i); return } catch (e: Exception) { }
      }
    } else {
      askFiles.launch(arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE, android.Manifest.permission.WRITE_EXTERNAL_STORAGE))
    }
  }

  // ---- One-click updates (Settings → About → "Update now"). The page passes only the build
  // ("build-24"); the address is made here. The APK is checked to be this app and newer, then
  // handed to Android's own installer, which accepts it only if it's signed with the same key as
  // this app: that is the check that it's genuine. Android asks "Do you want to update this
  // app?" itself, and doesn't start the app again afterwards.
  @Volatile private var updateTag: String? = null // waiting for "Install unknown apps" to be allowed
  @Volatile private var updateApk: File? = null   // downloaded and checked, ready to install
  private val updating = AtomicBoolean(false)

  /** Tell the page how the update is going (Settings → About shows it). */
  fun updateEvent(stage: String, msg: String = "") {
    val js = "document.dispatchEvent(new CustomEvent('lean-update',{detail:{stage:${JSONObject.quote(stage)},msg:${JSONObject.quote(msg)}}}))"
    runOnUiThread { web?.evaluateJavascript(js, null) }
  }

  fun startUpdate(tag: String) {
    val n = Regex("^build-([0-9]{1,6})$").find(tag)?.groupValues?.get(1)
    if (n == null) { updateEvent("error", "That isn’t a build of thinky."); return }
    // Android 8 and later ask once whether this app may install apps
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
      updateTag = tag
      updateEvent("permission")
      runOnUiThread {
        try { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) }
        catch (e: Exception) {
          updateTag = null
          updateEvent("error", "Android’s “Install unknown apps” screen didn’t open. Allow it for thinky in Android’s settings, then try again.")
        }
      }
      return
    }
    if (!updating.compareAndSet(false, true)) return // already on its way
    Thread { try { downloadUpdate(n) } finally { updating.set(false) } }.start()
  }

  override fun onResume() {
    super.onResume()
    // back from Android's "Install unknown apps" screen: carry on if it was allowed
    val tag = updateTag ?: return
    updateTag = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls())
      updateEvent("error", "thinky wasn’t allowed to install apps, so it can’t update itself.")
    else startUpdate(tag)
  }

  private fun downloadUpdate(n: String) {
    updateApk = null
    val dir = File(cacheDir, "update-apk")
    dir.deleteRecursively()
    dir.mkdirs()
    val apk = File(dir, "LeanOutliner.apk")
    try {
      updateEvent("download")
      val c = URL("https://github.com/srikanth-iyer/lean-outliner-releases/releases/download/build-$n/LeanOutliner.apk").openConnection() as HttpURLConnection
      c.connectTimeout = 20000
      c.readTimeout = 30000
      val code = c.responseCode // after GitHub's redirect to its download server (https only)
      if (code != 200) throw Exception(if (code == 404) "it isn’t on the downloads page" else "the downloads page answered $code")
      if (c.url.protocol != "https") throw Exception("not a secure connection")
      val total = c.contentLengthLong
      c.inputStream.use { input ->
        apk.outputStream().use { out ->
          val buf = ByteArray(64 * 1024)
          var got = 0L
          var shown = -1
          while (true) {
            val r = input.read(buf)
            if (r < 0) break
            out.write(buf, 0, r)
            got += r
            if (got > 300_000_000) throw Exception("the file is far too big")
            if (total > 0 && (got * 20 / total).toInt() != shown) {
              shown = (got * 20 / total).toInt()
              updateEvent("download", "${shown * 5}%")
            }
          }
        }
      }
    } catch (e: Exception) {
      dir.deleteRecursively()
      updateEvent("error", "The update couldn’t be downloaded (${e.message ?: e.javaClass.simpleName}). Check the internet connection and try again.")
      return
    }
    updateEvent("check")
    @Suppress("DEPRECATION")
    val got = try { packageManager.getPackageArchiveInfo(apk.path, 0) } catch (e: Exception) { null }
    val mine = packageManager.getPackageInfo(packageName, 0)
    val problem = when {
      got == null -> "the download isn’t an app (it may be damaged)"
      got.packageName != packageName -> "the download is a different app"
      versionOf(got) <= versionOf(mine) -> "the download isn’t newer than this version"
      !signedLikeThisApp(apk) -> "the download isn’t signed like this app (so it may not be genuine)"
      else -> null
    }
    if (problem != null) {
      dir.deleteRecursively()
      updateEvent("error", "Nothing was installed: $problem.")
      return
    }
    updateApk = apk
    updateEvent("ready")
  }

  private fun versionOf(p: PackageInfo): Long = PackageInfoCompat.getLongVersionCode(p)

  /** Is the APK signed with this app's key? Android checks that too when it installs; this says so
   *  plainly, before asking him. Android 9 and later (before that, Android's own check only). */
  @Suppress("DEPRECATION")
  private fun signedLikeThisApp(apk: File): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return true
    val flags = PackageManager.GET_SIGNING_CERTIFICATES
    val theirs = (try { packageManager.getPackageArchiveInfo(apk.path, flags)?.signingInfo } catch (e: Exception) { null }) ?: return true
    val ours = packageManager.getPackageInfo(packageName, flags).signingInfo ?: return true
    // this app's current certificate(s) must be among the download's (which may also list older ones)
    val now = (if (ours.hasMultipleSigners()) ours.apkContentsSigners?.toList() else ours.signingCertificateHistory?.lastOrNull()?.let { listOf(it) }) ?: return true
    val theirSet = (if (theirs.hasMultipleSigners()) theirs.apkContentsSigners else theirs.signingCertificateHistory)?.toSet() ?: return true
    return now.isNotEmpty() && now.all { it in theirSet }
  }

  /** Hand the checked APK to Android's installer (the page saved everything first). */
  fun installUpdate() {
    val apk = updateApk
    if (apk == null) { updateEvent("error", "Download the update again first."); return }
    updateApk = null
    Thread {
      val pi = packageManager.packageInstaller
      var id = -1
      try {
        // an earlier update (cancelled, or never confirmed) shouldn't linger
        for (old in pi.mySessions) try { pi.abandonSession(old.sessionId) } catch (e: Exception) { }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(packageName)
        id = pi.createSession(params)
        pi.openSession(id).use { s ->
          s.openWrite("LeanOutliner.apk", 0, apk.length()).use { out ->
            apk.inputStream().use { it.copyTo(out) }
            s.fsync(out)
          }
          // Android reports to UpdateReceiver (not exported: nothing else can reach it)
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
          s.commit(PendingIntent.getBroadcast(this, id, Intent(this, UpdateReceiver::class.java), flags).intentSender)
        }
        updateEvent("install")
      } catch (e: Exception) {
        if (id >= 0) try { pi.abandonSession(id) } catch (x: Exception) { }
        updateEvent("error", "Android’s installer didn’t start (${e.message ?: e.javaClass.simpleName}).")
      } finally {
        apk.parentFile?.deleteRecursively() // Android keeps its own copy for the install
      }
    }.start()
  }

  @SuppressLint("JavascriptInterface", "AddJavascriptInterface")
  override fun onWebViewCreate(webView: WebView) {
    web = webView
    // the brand's cream until the page paints (its start-up drawing is on the same cream): never a
    // white or dark flash between Android's splash and the drawing (he asked, Oct 30)
    webView.setBackgroundColor(0xFFF4EEE3.toInt())
    webView.addJavascriptInterface(Bridge(), "LeanAndroid")
  }

  inner class Bridge {
    @JavascriptInterface fun hasAllFilesAccess(): Boolean = hasAllFiles()
    @JavascriptInterface fun openAllFilesSettings() { runOnUiThread { this@MainActivity.openAllFilesSettings() } }
    /** Tells the home-screen widget where today's journal lives. */
    @JavascriptInterface fun setWidgetConfig(vault: String, journalsDir: String, fileFormat: String, titleFormat: String) {
      Journal.save(this@MainActivity, vault, journalsDir, fileFormat, titleFormat)
      Journal.refresh(this@MainActivity)
    }
    /** Quick capture format (config.edn) for the share pop-up and the widget's +. */
    @JavascriptInterface fun setCaptureConfig(json: String) { Journal.saveCapture(this@MainActivity, json) }
    /** To-dos due today, shown at the top of the widget. */
    @JavascriptInterface fun setWidgetTasks(json: String) {
      Journal.saveTasks(this@MainActivity, json)
      Journal.refresh(this@MainActivity)
    }
    @JavascriptInterface fun refreshWidget() { Journal.refresh(this@MainActivity) }
    @JavascriptInterface fun setWidgetColors(bg: String, ink: String, faint: String, accent: String) {
      Journal.saveColors(this@MainActivity, bg, ink, faint, accent)
      Journal.refresh(this@MainActivity)
    }
    /** The look's page colour, for the strips at the top and bottom of the screen. */
    @JavascriptInterface fun setBarColors(bg: String, light: Boolean) {
      val c = try { android.graphics.Color.parseColor(bg.trim()) } catch (e: Exception) { return }
      Journal.prefs(this@MainActivity).edit().putInt("bar_bg", c).putBoolean("bar_light", light).apply()
      runOnUiThread { paintBars(c, light) }
    }
    /** Back at the start of the app: go to the home screen, like other apps (the app stays ready). */
    @JavascriptInterface fun leave() { runOnUiThread { moveTaskToBack(true) } }
    /** The shortcut picked on the app icon ("today" or "search"), handed over once; null if none. */
    @JavascriptInterface fun takeShortcut(): String? = shortcut.getAndSet(null)
    /** Keyboard for the box the page has just focused (the search box from the Search shortcut);
     *  a moment later, so the page's focus has reached Android first. */
    @JavascriptInterface fun showKeyboard() { web?.postDelayed({ this@MainActivity.showKeyboard() }, 150) }
    /** Print the current page, or save it as a PDF (Android's print screen). */
    @JavascriptInterface fun print(title: String) {
      runOnUiThread {
        val w = web ?: return@runOnUiThread
        val pm = getSystemService(Context.PRINT_SERVICE) as PrintManager
        val name = title.ifBlank { "thinky" }
        pm.print(name, w.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
      }
    }
    /** "Update now": download build `tag` ("build-24") and check it; the page hears how it goes
     *  ("lean-update" events) and, once it has saved everything, calls installUpdate. */
    @JavascriptInterface fun update(tag: String) { this@MainActivity.startUpdate(tag) }
    @JavascriptInterface fun installUpdate() { this@MainActivity.installUpdate() }
    /** Test builds only (debuggable: the emulator test): hand this app's own APK to Android's
     *  installer, to check the steps after "ready" (the test then cancels). Does nothing in a release. */
    @JavascriptInterface fun testInstallSelf() {
      if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) return
      val dir = File(cacheDir, "update-apk").apply { deleteRecursively(); mkdirs() }
      val apk = File(dir, "LeanOutliner.apk")
      File(applicationInfo.sourceDir).copyTo(apk, overwrite = true)
      updateApk = apk
      this@MainActivity.installUpdate()
    }
    /** Test builds only (the emulator test, step 7b): the widgets' colours as they come out, made
     *  from the same RemoteViews the home screen gets (JournalWidget.paint, a row from the list's
     *  factory, QuickAddWidget.paint), applied to real views here: JSON of "#rrggbb" for the journal
     *  widget's background, title, "+", empty line and first row, and the one-tap "+" drawn (its
     *  circle beside the plus, and the plus). "{}" in a release. */
    @JavascriptInterface fun testWidgetColors(): String {
      if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) return "{}"
      val out = JSONObject()
      val done = java.util.concurrent.CountDownLatch(1)
      runOnUiThread {
        try {
          val ctx = this@MainActivity
          fun hex(c: Int) = String.format(java.util.Locale.US, "#%06x", c and 0xFFFFFF)
          val parent = android.widget.FrameLayout(ctx)
          val rv = android.widget.RemoteViews(packageName, R.layout.widget_journal)
          JournalWidget.paint(ctx, rv)
          val v = rv.apply(ctx, parent)
          val bg = v.findViewById<View>(android.R.id.background) ?: v
          out.put("bg", hex((bg.background as? android.graphics.drawable.ColorDrawable)?.color ?: 0))
          for ((k, id) in listOf("title" to R.id.widget_title, "add" to R.id.widget_add, "empty" to R.id.widget_empty)) {
            out.put(k, hex(v.findViewById<android.widget.TextView>(id).currentTextColor))
          }
          val f = JournalWidgetService.Factory(applicationContext)
          f.onDataSetChanged()
          val items = Journal.items(ctx)
          val i = items.indexOfFirst { it.kind == Journal.NOTE }
          if (i >= 0) out.put("row", hex((f.getViewAt(i).apply(ctx, parent) as android.widget.TextView).currentTextColor))
          out.put("rows", items.size)
          val q = android.widget.RemoteViews(packageName, R.layout.widget_quick_add)
          QuickAddWidget.paint(ctx, q)
          val qv = q.apply(ctx, parent)
          val dp = resources.displayMetrics.density
          val size = (80 * dp).toInt()
          val spec = View.MeasureSpec.makeMeasureSpec(size, View.MeasureSpec.EXACTLY)
          qv.measure(spec, spec)
          qv.layout(0, 0, size, size)
          val bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
          qv.draw(android.graphics.Canvas(bmp))
          val c = size / 2
          val off = (8 * dp).toInt() // inside the circle, away from the plus's two strokes
          out.put("circle", hex(bmp.getPixel(c + off, c + off)))
          out.put("plus", hex(bmp.getPixel(c, c)))
        } catch (e: Exception) {
          out.put("error", e.toString())
        } finally {
          done.countDown()
        }
      }
      done.await(5, java.util.concurrent.TimeUnit.SECONDS)
      return out.toString()
    }
  }
}

/** Android's installer reports here how the update went (see MainActivity.installUpdate). Not
 *  exported: only Android's installer, through the app's own PendingIntent, can reach it. */
class UpdateReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) {
    val app = MainActivity.live?.get()
    val st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      // Android asks "Do you want to update this app?" in its own window
      @Suppress("DEPRECATION") val ask = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
      if (ask == null) { app?.updateEvent("error", "Android’s installer didn’t ask to go ahead."); return }
      ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try { (app ?: c).startActivity(ask); app?.updateEvent("confirm") }
      catch (e: Exception) { app?.updateEvent("error", "Android’s installer didn’t open (${e.message}).") }
      return
    }
    val why = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $st"
    app?.updateEvent(when (st) {
      PackageInstaller.STATUS_SUCCESS -> "done"
      else -> "error"
    }, when (st) {
      PackageInstaller.STATUS_SUCCESS -> ""
      PackageInstaller.STATUS_FAILURE_ABORTED -> "The update was cancelled. If Google Play Protect asked to scan it, tap Update now again once the scan is done. ($why; ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}, Android ${android.os.Build.VERSION.RELEASE})"
      PackageInstaller.STATUS_FAILURE_CONFLICT -> "Android refused the update: it isn’t signed like the app on this phone ($why)."
      PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "Android says this update doesn’t suit this phone ($why)."
      PackageInstaller.STATUS_FAILURE_STORAGE -> "There isn’t enough space on the phone for the update."
      PackageInstaller.STATUS_FAILURE_INVALID -> "The download is damaged ($why)."
      else -> "Android didn’t install the update ($why)."
    })
  }
}
