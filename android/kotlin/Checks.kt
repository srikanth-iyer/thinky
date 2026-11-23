// Small rules with no Android parts in them, so they can be tested on any computer: android/test/run.sh
// compiles this file with android/test/ChecksTest.kt and runs it on a plain JVM (no phone, no Android
// SDK). The Android code calls them: AiKeys (where a key may go), JournalWidget (the size a small
// picture is read at), QuickCaptureActivity (whose picture it is, reading with a limit) and
// SelectionCaptureActivity (how often and how much), MainActivity (the update's signature file),
// JournalWidget and QuickCaptureActivity (today's journal file and title). Each says which rule of the
// app's it mirrors.
// The package line is added by scripts/android_overlay.py.

import java.io.InputStream
import java.util.Calendar
import java.util.Locale
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

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

  // ---- the update's signature file (MainActivity.downloadUpdate; the outside review's item 3, Nov 21)
  // Each release "build-N" carries thinky-apk.sig beside thinky.apk: JSON {"file", "version", "build",
  // "sha256", "sig"} made by CI (scripts/update_sig.py sign-update), the same kind of file and the same
  // key as the Windows installer's thinky-update.sig (core/src/update.rs update_text_to_verify, whose
  // rules these mirror). "sig" is an ECDSA P-256 / SHA-256 signature (base64 of r‖s, 32 bytes each) of
  // a short text naming the file, its version, the build and the file's SHA-256 checksum. The phone
  // installs a download only if that signature checks out with the public key built into the app, so
  // a file that isn't from the release job (or is a genuine older one offered as newer) is refused
  // before Android's installer even sees it.

  /** The APK and its signature file, as named on the downloads page. */
  const val APK_FILE = "thinky.apk"
  const val APK_SIG_FILE = "thinky-apk.sig"
  /** A signature file is a few hundred bytes; anything far bigger isn't one (read with readAtMost). */
  const val SIG_MAX_BYTES = 16 * 1024

  /** The fixed start (DER) of a P-256 public key in the standard "SubjectPublicKeyInfo" form, before
   *  the key's point 04‖X‖Y (scripts/update_sig.py SPKI_P256 is the same bytes). */
  private val SPKI_P256 = hexBytes("3059301306072a8648ce3d020106082a8648ce3d030107034200")!!

  /** A signature file's fields, as MainActivity read them from its JSON (null where one was missing or
   *  of the wrong kind; `build` is null unless it was a whole number). */
  data class UpdateSig(val file: String?, val version: String?, val build: Long?, val sha256: String?, val sig: String?)

  /** "0.6.4" → (0, 6, 4); anything else (not three parts, not only digits, a part over 9 digits) →
   *  null. As core update::parse_version. */
  fun parseVersion(s: String?): Triple<Long, Long, Long>? {
    val parts = s?.split('.') ?: return null
    if (parts.size != 3) return null
    // each part: 1 to 9 digits 0-9 (no sign, no spaces, no letters)
    if (parts.any { p -> p.isEmpty() || p.length > 9 || !p.all { it in '0'..'9' } }) return null
    return Triple(parts[0].toLong(), parts[1].toLong(), parts[2].toLong())
  }

  /** Is version `a` higher than version `b`? Compared part by part, the first part first. */
  fun higherVersion(a: Triple<Long, Long, Long>, b: Triple<Long, Long, Long>): Boolean =
    compareValuesBy(a, b, { it.first }, { it.second }, { it.third }) > 0

  /** The exact text CI signs (core update::update_text, update_sig.py update_text). */
  fun updateText(file: String, version: String, build: Long, sha256Hex: String): String =
    "thinky-update-2\n$file\n$version\nbuild $build\n$sha256Hex\n"

  /** Standard base64 (with or without "=" at the end) → bytes; null for anything else. As core
   *  update::base64_decode (java.util.Base64 needs Android 8, and this runs on older phones too). */
  fun base64Decode(text: String): ByteArray? {
    val s = text.trim().trimEnd('=')
    val out = java.io.ByteArrayOutputStream(s.length * 3 / 4)
    var acc = 0   // bits read but not yet written out
    var bits = 0  // how many of them
    for (c in s) {
      val v = when (c) {
        in 'A'..'Z' -> c - 'A'
        in 'a'..'z' -> c - 'a' + 26
        in '0'..'9' -> c - '0' + 52
        '+' -> 62
        '/' -> 63
        else -> return null // anything else (a space, a "-", a letter from another alphabet) isn't base64
      }
      acc = (acc shl 6) or v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out.write((acc shr bits) and 0xFF)
        acc = acc and ((1 shl bits) - 1)
      }
    }
    return out.toByteArray()
  }

  /** "0a1b…" (an even number of hex digits) → bytes; null for anything else. */
  fun hexBytes(hex: String): ByteArray? {
    if (hex.length % 2 != 0 || !hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
    return ByteArray(hex.length / 2) { i -> hex.substring(2 * i, 2 * i + 2).toInt(16).toByte() }
  }

  /** Bytes → lowercase hex ("0a1b…"). */
  fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) }

  /** The SHA-256 checksum of everything `input` gives, in lowercase hex (MainActivity works it out
   *  while it saves the download, so the file is read once). */
  fun sha256Hex(input: InputStream): String {
    val md = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(64 * 1024)
    while (true) {
      val r = input.read(buf)
      if (r < 0) break
      md.update(buf, 0, r)
    }
    return hex(md.digest())
  }

  /** The update key's public half from the text built into the app (base64 of X‖Y, 64 bytes: as
   *  ci/update-key.pub and Windows' LEAN_UPDATE_KEY), or null when there is none or it isn't a P-256
   *  point (then every update is refused: a build made without the key can't check one). */
  fun updateKey(b64: String?): PublicKey? {
    val point = b64?.let { base64Decode(it) } ?: return null
    if (point.size != 64 || !onP256(point)) return null
    return try {
      KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(SPKI_P256 + byteArrayOf(4) + point))
    } catch (e: Exception) { null } // not a point on the curve, or no EC support: no key
  }

  /** Is X‖Y a point on the P-256 curve (y² = x³ − 3x + b, counted modulo the curve's prime p)? Java
   *  doesn't always check this itself when it reads a key, so a mistyped key is caught here. */
  fun onP256(point: ByteArray): Boolean {
    if (point.size != 64) return false
    val p = java.math.BigInteger("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff", 16)
    val b = java.math.BigInteger("5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b", 16)
    val x = java.math.BigInteger(1, point.copyOfRange(0, 32)) // (1 = a positive number)
    val y = java.math.BigInteger(1, point.copyOfRange(32, 64))
    if (x >= p || y >= p) return false
    val left = y.multiply(y).mod(p)
    val right = x.pow(3).subtract(x.multiply(java.math.BigInteger.valueOf(3))).add(b).mod(p)
    return left == right
  }

  /** r‖s (32 bytes each) → the DER form Java's Signature reads (SEQUENCE { INTEGER r, INTEGER s }).
   *  As update_sig.py raw_to_der. */
  fun rawToDer(raw: ByteArray): ByteArray? {
    if (raw.size != 64) return null
    fun integer(b: ByteArray): ByteArray {
      var x = b.dropWhile { it == 0.toByte() }.toByteArray()                  // no leading zero bytes…
      if (x.isEmpty()) x = byteArrayOf(0)                                     // …but zero is one 0 byte
      if (x[0].toInt() and 0x80 != 0) x = byteArrayOf(0) + x                  // a set top bit would read as negative
      return byteArrayOf(2, x.size.toByte()) + x                              // 2 = INTEGER, then its length
    }
    val body = integer(raw.copyOfRange(0, 32)) + integer(raw.copyOfRange(32, 64))
    return byteArrayOf(0x30, body.size.toByte()) + body                       // 0x30 = SEQUENCE
  }

  /** Does `sig` (r‖s, base64) sign `text` with `key`? False for anything unreadable. */
  fun signatureGood(key: PublicKey, text: String, sigB64: String): Boolean = try {
    val der = base64Decode(sigB64)?.let { rawToDer(it) }
    if (der == null) false
    else Signature.getInstance("SHA256withECDSA").run {
      initVerify(key)
      update(text.toByteArray(Charsets.UTF_8))
      verify(der)
    }
  } catch (e: Exception) { false }

  /** Why the downloaded APK must not be installed, or null when its signature file checks out: the
   *  file is for thinky.apk and for build `n` (the build the app asked for, never the file's word), its
   *  version is higher than this app's (`ownVersion`), its checksum is the download's (`apkSha256`,
   *  worked out by the app from the bytes it saved) and its signature is good for the text made from
   *  those (as core update::update_text_to_verify). Fails closed: no key, no file, anything unreadable
   *  is a reason. The words go after "Nothing was installed: ". */
  fun apkSigProblem(key: PublicKey?, sig: UpdateSig?, n: Long, ownVersion: String?, apkSha256: String): String? {
    if (key == null) return "this copy of thinky was built without the update key, so it can’t check an update"
    if (sig == null) return "build $n has no signature file for the phone ($APK_SIG_FILE), so it can’t be checked"
    if (sig.file != APK_FILE) return "the signature file is for ${sig.file ?: "no file"}, not $APK_FILE"
    if (sig.build != n) return "the signature file isn’t for build $n"
    val v = parseVersion(sig.version) ?: return "the signature file’s version (${sig.version}) can’t be read"
    val own = parseVersion(ownVersion) ?: return "this app’s version ($ownVersion) can’t be read"
    if (!higherVersion(v, own)) return "version ${sig.version} isn’t newer than this one ($ownVersion)"
    val sha = sig.sha256?.lowercase()
    if (sha == null || sha.length != 64 || hexBytes(sha) == null) return "the signature file’s checksum isn’t valid"
    if (sha != apkSha256.lowercase()) return "the download doesn’t match its signature file (it may be damaged)"
    // the text is made from what the app asked for and worked out itself: nothing in the file is taken on trust
    val text = updateText(APK_FILE, sig.version!!, n, apkSha256.lowercase())
    if (!signatureGood(key, text, sig.sig ?: "")) return "the download’s signature isn’t thinky’s (so it may not be genuine)"
    return null
  }

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

  // ---- the journal widget's notes (Journal.notes)

  /** A page's text without its YAML front matter (the page's own settings, not notes), exactly as
   *  core doc::front_matter_len finds it: a first line "---", then within 300 lines a "---" or "..."
   *  line after at least one `key: value` line; blank lines and # comments may come between, and
   *  indented or "- " lines only after a key. Anything else: no front matter, the text as it is. */
  fun withoutFrontMatter(text: String): String {
    val lines = text.split('\n')
    if (lines[0].trimEnd('\r').trimEnd() != "---") return text
    var keys = 0
    for (j in 1 until minOf(lines.size, 301)) {
      val t = lines[j].removeSuffix("\r")
      if (t.trimEnd() == "---" || t.trimEnd() == "...") return if (keys > 0) lines.drop(j + 1).joinToString("\n") else text
      if (t.isBlank() || t.startsWith("#")) continue
      if (t.startsWith(" ") || t.startsWith("\t") || t.startsWith("- ")) { if (keys == 0) return text; continue }
      if (!yamlKey(t)) return text
      keys++
    }
    return text
  }

  /** `key: value` (YAML), not `key:: value` (a Logseq property): core doc::yaml_key. */
  private fun yamlKey(t: String): Boolean {
    val i = t.indexOf(':')
    if (i <= 0) return false
    val k = t.substring(0, i); val v = t.substring(i + 1)
    return k.all { it.isLetterOrDigit() || it in "-_." } && (v.isEmpty() || v.startsWith(" "))
  }

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

  // ---- today's journal: its file and its title (JournalWidget.todayFile / todayTitle; core date.rs
  // `format` and config.rs `journal_rel_path`). The widget must read the very file the app writes
  // notes to, so these follow the core's rules exactly; ChecksTest has the core's own test cases
  // (audit finding 17: before, these sat in JournalWidget.kt, where no test could run them).

  private val MONTHS = arrayOf("January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December")
  private val DAYS = arrayOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
  /** The date-fns tokens the core knows, longest first where one starts another (core date.rs TOKENS). */
  private val TOKENS = listOf("yyyy", "yy", "MMMM", "MMM", "MM", "M", "do", "dd", "d", "EEEE", "EEE", "EE", "E")

  /** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 to 13 → "th", 22 → "22nd" (core date.rs `ordinal`). */
  fun ordinal(d: Int): String {
    val suf = if (d % 100 in 11..13) "th" else when (d % 10) { 1 -> "st"; 2 -> "nd"; 3 -> "rd"; else -> "th" }
    return "$d$suf"
  }

  /** The day `c` written in date-fns style tokens, same rules as core/src/date.rs `format`: the tokens
   *  above; text in single quotes is kept as it is (an unclosed quote runs to the end); anything else
   *  is kept as it is. */
  fun formatDate(fmt: String, c: Calendar): String {
    val y = c.get(Calendar.YEAR) // the year, e.g. 2026
    val m = c.get(Calendar.MONTH) + 1 // the month, 1 to 12 (Calendar counts from 0)
    val d = c.get(Calendar.DAY_OF_MONTH) // the day of the month, 1 to 31
    val wd = c.get(Calendar.DAY_OF_WEEK) - 1 // the weekday, 0 = Sunday (Calendar counts from 1)
    val sb = StringBuilder() // the text made so far
    var i = 0 // where in `fmt` we are
    while (i < fmt.length) {
      if (fmt[i] == '\'') {
        // quoted words: kept as they are, up to the closing quote (or the end)
        val end = fmt.indexOf('\'', i + 1).let { if (it < 0) fmt.length else it }
        sb.append(fmt, i + 1, end)
        i = end + 1
        continue
      }
      val t = TOKENS.firstOrNull { fmt.startsWith(it, i) } // a token starting here, if any
      if (t == null) { sb.append(fmt[i]); i++; continue } // any other character: as it is
      sb.append(when (t) {
        "yyyy" -> String.format(Locale.US, "%04d", y)
        "yy" -> String.format(Locale.US, "%02d", y % 100)
        "MMMM" -> MONTHS[m - 1]
        "MMM" -> MONTHS[m - 1].substring(0, 3)
        "MM" -> String.format(Locale.US, "%02d", m)
        "M" -> m.toString()
        "do" -> ordinal(d)
        "dd" -> String.format(Locale.US, "%02d", d)
        "d" -> d.toString()
        "EEEE" -> DAYS[wd]
        else -> DAYS[wd].substring(0, 3) // EEE, EE, E: the weekday's first three letters
      })
      i += t.length
    }
    return sb.toString()
  }

  /** Today's journal file inside the notes folder, "journals/2026_11_23.md" (core config.rs
   *  `journal_rel_path`): `dir` (:journals-directory, from the core, already checked to be inside the
   *  notes folder; checked again here: null when it has a ".." part or starts at the top) and the file
   *  name format `fmt` (:journal/file-name-format); a name that would leave the journals folder (empty,
   *  starting with ".", or with / \ : or a NUL in it) falls back to yyyy_MM_dd, as the core does. */
  fun journalRelPath(dir: String, fmt: String, c: Calendar): String? {
    var stem = formatDate(fmt, c) // the file's name without ".md"
    if (stem.isEmpty() || stem.startsWith(".") || stem.any { it == '/' || it == '\\' || it == ':' || it == '\u0000' }) stem = formatDate("yyyy_MM_dd", c)
    if (dir.split('/', '\\').any { it == ".." } || dir.startsWith("/")) return null
    return "$dir/$stem.md"
  }
}
