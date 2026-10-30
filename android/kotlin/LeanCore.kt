// The app's own Rust code, for the "Add a note" pop-up (QuickCaptureActivity), which also works
// while the app is closed: it loads the app's library itself and adds through
// src-tauri/src/android_capture.rs, so a note goes exactly where the app and the Windows box put it.
// The package line and __RUST_LIB__ (the library's name, from src-tauri/Cargo.toml) are filled in by
// scripts/android_overlay.py, which also checks the package: the Rust function's name
// (Java_com_srikanth_leanoutliner_LeanCore_capture) depends on it.

import android.content.Context
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

object LeanCore {
  /** The core's limit for a picture or file (outline_core::app::MAX_ASSET_BYTES): read one byte more,
   *  so the core says it's too big. */
  private const val MAX_BYTES = 25_000_000

  @Volatile private var loaded = false

  /** In Rust: JSON in, JSON out (see android_capture.rs); bytes = a shared picture, or null. */
  @JvmStatic external fun capture(args: String, bytes: ByteArray?): String?

  /** Loads the app's library (a no-op when the app already runs in this process). Null when it
   *  worked, else why not, in words to show. Slow-ish the first time: call it off the screen's thread. */
  @Synchronized fun load(): String? {
    if (loaded) return null
    return try {
      System.loadLibrary("__RUST_LIB__")
      loaded = true
      android.util.Log.i("LeanCore", "loaded __RUST_LIB__")
      null
    } catch (e: Throwable) {
      android.util.Log.w("LeanCore", "couldn't load __RUST_LIB__", e)
      "Couldn't start the part of the app that adds notes (${e.message ?: e.javaClass.simpleName})."
    }
  }

  /** A note that couldn't be added: the reason to show, and a picture already copied, if any (its
   *  Markdown: the next try adds that instead of copying it again). */
  class Failed(message: String, val link: String? = null) : Exception(message)

  /** What every call sends: the app's own folders (as Tauri gives them to the app: cacheDir and
   *  dataDir, so the notes folder is read with the app's index cache), the notes folder, and the
   *  phone's day and time. */
  private fun base(ctx: Context): JSONObject {
    val c = Calendar.getInstance()
    val data = if (Build.VERSION.SDK_INT >= 24) ctx.dataDir.absolutePath else ctx.applicationInfo.dataDir
    return JSONObject()
      .put("cache", ctx.cacheDir.absolutePath)
      .put("data", data)
      .put("vault", Journal.vault(ctx)?.path ?: "")
      .put("y", c.get(Calendar.YEAR)).put("m", c.get(Calendar.MONTH) + 1).put("d", c.get(Calendar.DAY_OF_MONTH))
      .put("time", String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE)))
  }

  private fun call(args: JSONObject, bytes: ByteArray? = null): JSONObject {
    load()?.let { throw Failed(it) }
    val out: String = (try { capture(args.toString(), bytes) } catch (e: Throwable) {
      throw Failed("Couldn't add it (${e.message ?: e.javaClass.simpleName}), so nothing was added.")
    }) ?: throw Failed("Couldn't add it, so nothing was added.")
    val r = try { JSONObject(out) } catch (e: Exception) { throw Failed("Couldn't add it ($out).") }
    if (!r.optBoolean("ok", false)) throw Failed(r.optString("error", "Couldn't add it."), r.optString("link", "").ifEmpty { null })
    return r
  }

  /** Where notes go now (config.edn as it is): today's journal's title or the page's name. */
  fun where(ctx: Context): String {
    val r = call(base(ctx).put("cmd", "where"))
    return r.optString("page")
  }

  /** Typed or shared words → a note in the quick capture template. Returns the file written. */
  fun addText(ctx: Context, text: String): String = call(base(ctx).put("text", text)).optString("rel")

  /** A shared picture: copied into assets/ by the core (Logseq's name; its own extension, else its
   *  type's), then linked in the media template. `link`: one copied by an earlier try. */
  fun addPicture(ctx: Context, uri: Uri, name: String, link: String?): String {
    if (link != null) return call(base(ctx).put("link", link)).optString("rel")
    val typeExt: String = (try {
      ctx.contentResolver.getType(uri)?.let { android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
    } catch (e: Exception) { null }) ?: ""
    val bytes = try {
      val input = ctx.contentResolver.openInputStream(uri) ?: throw Failed("Couldn't open the picture, so nothing was added.")
      input.use { i ->
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        while (out.size() <= MAX_BYTES) {
          val n = i.read(buf)
          if (n < 0) break
          out.write(buf, 0, n)
        }
        out.toByteArray()
      }
    } catch (e: Failed) { throw e } catch (e: Throwable) {
      throw Failed("Couldn't read the picture (${e.message ?: e.javaClass.simpleName}), so nothing was added.")
    }
    return call(base(ctx).put("name", name).put("typeExt", typeExt), bytes).optString("rel")
  }
}
