// Small rules with no Android parts in them, so they can be tested on any computer: android/test/run.sh
// compiles this file with android/test/ChecksTest.kt and runs it on a plain JVM (no phone, no Android
// SDK). The Android code calls them: AiKeys (where a key may go), JournalWidget (the size a small
// picture is read at), QuickCaptureActivity (whose picture it is, reading with a limit) and
// SelectionCaptureActivity (how often and how much). Each says which rule of the app's it mirrors.
// The package line is added by scripts/android_overlay.py.

import java.io.InputStream

object Checks {
  // ---- AI keys (Build 51; the outside review's claim 1): a service's key goes only to that service.

  /** The fixed address of each service that needs a key. These MUST match core/src/ai.rs PROVIDERS
   *  (`base`): the page builds the request with the core, and the key goes only to these. */
  val KEY_BASES = mapOf(
    "claude" to "https://api.anthropic.com/v1",
    "openai" to "https://api.openai.com/v1",
    "gemini" to "https://generativelanguage.googleapis.com/v1beta/openai",
    "openrouter" to "https://openrouter.ai/api/v1",
  )

  /** Where a service's key goes in the request, as core ai::key_header: "x-api-key" for Claude,
   *  "bearer" (an Authorization header) for the OpenAI-style ones and "Other", none for the programs
   *  on a computer (Ollama, LM Studio) or an unknown service. Never what the page's request says. */
  fun keyHeader(service: String): String? = when (service) {
    "claude" -> "x-api-key"
    "openai", "gemini", "openrouter", "other" -> "bearer"
    else -> null
  }

  /** An "Other" service's address, as core ai::check_base takes it (without a final "/"), or null:
   *  https only on the phone (AiKeys sends nothing over http), no spaces, quotes, backslashes or
   *  control characters, never an "@" (a name and password before the real computer), "{", "}", "?"
   *  or "#" anywhere (a base is followed by "/chat/completions", so it has no query or fragment); a name of letters, digits,
   *  "-" and "." (or an IPv6 address in [ ]) and an optional port of digits. */
  fun checkBase(base: String): String? {
    val b = base.trim().trimEnd('/')
    if (b.isEmpty() || b.any { it.isWhitespace() || it.isISOControl() || it == '"' || it == '\'' || it == '\\' || it == '@' || it == '{' || it == '}' || it == '?' || it == '#' }) return null
    if (!b.startsWith("https://")) return null
    val rest = b.substring("https://".length)
    val end = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }.let { if (it < 0) rest.length else it }
    val authority = rest.substring(0, end)
    val (host, port) = if (authority.startsWith("[")) {
      val close = authority.indexOf(']')
      if (close < 0) return null
      val h = authority.substring(1, close)
      if (h.isEmpty() || !h.all { it.isLetterOrDigit() && it.code < 128 || it == ':' || it == '.' } || !h.contains(':')) return null
      h to authority.substring(close + 1).removePrefix(":").takeIf { authority.length > close + 1 }
    } else {
      val i = authority.indexOf(':')
      (if (i < 0) authority else authority.substring(0, i)) to (if (i < 0) null else authority.substring(i + 1))
    }
    if (host.isEmpty()) return null
    if (!authority.startsWith("[") && !host.all { (it.isLetterOrDigit() && it.code < 128) || it == '-' || it == '.' }) return null
    if (!authority.startsWith("[") && (host.startsWith(".") || host.startsWith("-") || host.contains(".."))) return null
    if (port != null && (port.isEmpty() || port.length > 5 || !port.all { it in '0'..'9' })) return null
    // (after "]" only ":port" may follow)
    if (authority.startsWith("[") && authority.substring(authority.indexOf(']') + 1).let { it.isNotEmpty() && !it.startsWith(":") }) return null
    return b
  }

  /** May the key saved for `service` go with a request to `url`? As core ai::key_may_go: a service
   *  with a fixed address only to that address (its base, then "/"); "Other" only to the address saved
   *  with its key on this phone (`otherBase`, checked as checkBase does); the programs on a computer
   *  and unknown services never (they take no key). Exact and case-sensitive: the core builds the
   *  address from the same base. */
  fun keyMayGo(service: String, url: String, otherBase: String?): Boolean {
    if (url.any { it.isWhitespace() || it.isISOControl() }) return false
    val base = when (service) {
      in KEY_BASES -> KEY_BASES.getValue(service)
      "other" -> checkBase(otherBase ?: return false) ?: return false
      else -> return false
    }
    return url.startsWith("$base/")
  }

  // ---- the updater's check that a download is signed like this app (MainActivity.signedLikeThisApp)

  /** Is every one of `these` among `those`? Fails closed: false when either list is missing or
   *  `these` is empty (nothing known can't be "the same"). */
  fun <T> allAmong(these: List<T>?, those: List<T>?): Boolean =
    !these.isNullOrEmpty() && those != null && these.all { it in those }

  // ---- the journal widget's small pictures (JournalWidget.thumb; the review's claim 14c)

  /** The most pixels a widget row's small picture may have: Android sends every row's picture to the
   *  home screen in one message of about 1 MB at most, and the list may hold six. */
  const val THUMB_PIXELS = 100_000

  /** The box a row's small picture fits in, in pixels: 160 x 72 dp at the phone's `density`, made
   *  smaller (keeping its shape) when that is more than THUMB_PIXELS. */
  fun thumbBox(density: Float): Pair<Int, Int> {
    var w = maxOf(1, (160 * density).toInt())
    var h = maxOf(1, (72 * density).toInt())
    if (w.toLong() * h > THUMB_PIXELS) {
      val k = Math.sqrt(THUMB_PIXELS.toDouble() / (w.toLong() * h))
      w = maxOf(1, (w * k).toInt())
      h = maxOf(1, (h * k).toInt())
    }
    return w to h
  }

  /** How much to shrink a w x h picture while reading it (Android's inSampleSize, a power of two) so
   *  it comes out under twice the box `maxW` x `maxH` in BOTH directions: a tall screenshot (400 x
   *  12000) is read small too, not at full size. 1 for a picture that is small already. */
  fun sampleSize(w: Int, h: Int, maxW: Int, maxH: Int): Int {
    if (w <= 0 || h <= 0 || maxW <= 0 || maxH <= 0) return 1
    var s = 1
    while (s < (1 shl 16) && (w / (s * 2) >= maxW || h / (s * 2) >= maxH)) s *= 2
    return s
  }

  /** The size a w x h picture is drawn at in the box: shrunk to fit, never made bigger. */
  fun fitIn(w: Int, h: Int, maxW: Int, maxH: Int): Pair<Int, Int> {
    if (w <= 0 || h <= 0) return 0 to 0
    val k = minOf(maxW.toDouble() / w, maxH.toDouble() / h, 1.0)
    return maxOf(1, (w * k).toInt()) to maxOf(1, (h * k).toInt())
  }

  /** Read with a few bytes to spare? A JPEG has no see-through parts, so its small copy may take
   *  half the memory (Android's RGB_565); PNG, WebP and GIF pictures may be see-through, and keep it. */
  fun opaqueType(mime: String?): Boolean = mime.equals("image/jpeg", ignoreCase = true)

  // ---- the share pop-up's pictures (QuickCaptureActivity.sharedPicture; the review's claim 15)

  /** A content:// address's provider name (its "authority") that may be another app's: not empty,
   *  never with an "@" (Android reads "a@b@c" as the provider "c", so whatever comes before an "@"
   *  could hide this app's own provider behind another name), and not one of this app's own (they
   *  start with its package name). */
  fun otherAppsAuthority(authority: String?, pkg: String): Boolean =
    !authority.isNullOrEmpty() && '@' !in authority && !authority.startsWith(pkg, ignoreCase = true) && authority.none { it.isWhitespace() || it == '/' }

  /** Everything `input` gives, or null when it is more than `max` bytes (only max + 1 bytes are read
   *  then): never trusts the size the other app says. */
  fun readAtMost(input: InputStream, max: Int): ByteArray? {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(64 * 1024)
    while (true) {
      val n = input.read(buf, 0, minOf(buf.size, max + 1 - out.size()))
      if (n < 0) break
      out.write(buf, 0, n)
      if (out.size() > max) return null
    }
    return out.toByteArray()
  }

  // ---- "Add to thinky" over selected text (SelectionCaptureActivity; the review's claim 11a)

  /** The most characters one selection may add (android_capture.rs refuses more too: SELECTED_MAX). */
  const val SELECTED_MAX = 20_000
  /** At most this many selections in SELECTED_WINDOW_MS: far more than a person adds by hand, so an
   *  app that keeps asking can't fill the notes. */
  const val SELECTED_PER_WINDOW = 10
  const val SELECTED_WINDOW_MS = 60_000L

  /** The times (ms) of the selections added lately, from what was kept ("t1,t2,…"), only those in the
   *  window before `now` (a clock set back counts as now). */
  fun recentTimes(kept: String?, now: Long): List<Long> =
    (kept ?: "").split(',').mapNotNull { it.trim().toLongOrNull() }.filter { it in (now - SELECTED_WINDOW_MS + 1)..now }

  /** May one more selection be added now? */
  fun selectionAllowed(recent: List<Long>): Boolean = recent.size < SELECTED_PER_WINDOW

  // ---- the "Add a note" pop-up's to-do button (QuickCaptureActivity; core task::marker)

  private val MARKERS = listOf("TODO", "DOING", "DONE", "LATER", "NOW", "WAITING", "WAIT", "CANCELED", "CANCELLED", "IN-PROGRESS", "STARTED")

  /** The to-do word a note starts with ("TODO ", "LATER "…, with its space), or "". */
  fun markerAt(text: String): String = MARKERS.firstOrNull { text.startsWith("$it ") }?.let { "$it " } ?: ""

  /** The to-do button: a note that starts with a to-do word loses it, any other gets `marker` (TODO,
   *  or LATER with `:preferred-workflow :now`, as the app's own code says: LeanCore.where). Gives the
   *  new text and how far the cursor moves (negative: back). */
  fun toggleTodo(text: String, marker: String): Pair<String, Int> {
    val had = markerAt(text)
    if (had.isNotEmpty()) return text.substring(had.length) to -had.length
    val m = marker.trim().ifEmpty { "TODO" } + " "
    return (m + text) to m.length
  }
}
