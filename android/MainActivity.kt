// Replaces the MainActivity that `tauri android init` generates (see scripts/android_overlay.py).
// Adds: system-bar/keyboard insets, "All files access" for the Drive Sync folder,
// and a small JS bridge (window.LeanAndroid): file access + telling the journal widget where to look.

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
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
  }

  fun hasAllFiles(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

  fun openAllFilesSettings() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try {
        startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
      } catch (e: Exception) {
        startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
      }
    } else {
      requestPermissions(arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE, android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)
    }
  }

  @SuppressLint("JavascriptInterface", "AddJavascriptInterface")
  override fun onWebViewCreate(webView: WebView) {
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
    @JavascriptInterface fun refreshWidget() { Journal.refresh(this@MainActivity) }
    @JavascriptInterface fun setWidgetColors(bg: String, ink: String, faint: String, accent: String) {
      Journal.saveColors(this@MainActivity, bg, ink, faint, accent)
      Journal.refresh(this@MainActivity)
    }
  }
}
