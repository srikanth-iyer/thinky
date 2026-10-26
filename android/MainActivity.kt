// Replaces the MainActivity that `tauri android init` generates (see scripts/android_overlay.py).
// Adds: system-bar/keyboard insets, "All files access" for the Drive Sync folder,
// and a small JS bridge (window.LeanAndroid): file access, the widget and quick capture
// settings, printing, the look's colours for the status and navigation bars, and leaving
// the app (Android's Back at the start; the app handles Back itself, see App.onBack).

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.Settings
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var web: WebView? = null
  // Android 7–10 ask for file access with a dialog over the app: the app never leaves the screen, so
  // the page can't notice the answer by coming back to it. Tell it when the answer comes (App.start).
  private val askFiles = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
    web?.evaluateJavascript("document.dispatchEvent(new Event('lean-access'))", null)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    __EDGE__
    super.onCreate(savedInstanceState)
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
    val p = Journal.prefs(this)
    if (p.contains("bar_bg")) paintBars(p.getInt("bar_bg", 0), p.getBoolean("bar_light", true))
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

  @SuppressLint("JavascriptInterface", "AddJavascriptInterface")
  override fun onWebViewCreate(webView: WebView) {
    web = webView
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
    /** Print the current page, or save it as a PDF (Android's print screen). */
    @JavascriptInterface fun print(title: String) {
      runOnUiThread {
        val w = web ?: return@runOnUiThread
        val pm = getSystemService(Context.PRINT_SERVICE) as PrintManager
        val name = title.ifBlank { "Lean Outliner" }
        pm.print(name, w.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
      }
    }
  }
}
