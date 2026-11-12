// Home-screen widget showing today's journal (and to-dos due today), plus the settings the app
// sends, which QuickCaptureActivity reads too (it adds notes through the app's own code, LeanCore).
// The package line is added by scripts/android_overlay.py.

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Typeface
import android.media.ExifInterface
import android.view.View
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.util.TypedValue
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Calendar
import java.util.Locale

/** Where today's journal lives, and how to read/append it. Settings come from the app
 *  (setWidgetConfig / setCaptureConfig / setWidgetTasks); nothing runs in the background. */
object Journal {
  private const val PREFS = "lean_widget"
  private val MONTHS = arrayOf("January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December")
  private val DAYS = arrayOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
  private val TOKENS = listOf("yyyy", "yy", "MMMM", "MMM", "MM", "M", "do", "dd", "d", "EEEE", "EEE", "EE", "E")
  private val PROP = Regex("^[\\w.\\-/]+::")

  /** One line of the widget: a note of today's journal, a to-do due today, or a small heading. */
  data class Item(val depth: Int, var text: String, val kind: Int = NOTE)
  const val NOTE = 0
  const val TASK = 1
  const val HEADER = 2

  fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun save(ctx: Context, vault: String, journalsDir: String, fileFormat: String, titleFormat: String) {
    prefs(ctx).edit().putString("vault", vault).putString("dir", journalsDir)
      .putString("file", fileFormat).putString("title", titleFormat).apply()
  }

  /** Quick capture format from config.edn (as JSON: text, media, today, page, pagesDir). */
  fun saveCapture(ctx: Context, json: String) { prefs(ctx).edit().putString("capture", json).apply() }
  private fun capture(ctx: Context): JSONObject = try { JSONObject(prefs(ctx).getString("capture", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }

  /** To-dos due today, sent by the app: JSON {day: "2026-10-26", tasks: [{text, page}]}. */
  fun saveTasks(ctx: Context, json: String) { prefs(ctx).edit().putString("tasks", json).apply() }

  /** Colours of the app's current look (sent by the app whenever the look changes). */
  fun saveColors(ctx: Context, bg: String, ink: String, faint: String, accent: String) {
    fun parse(c: String, def: Int) = try { android.graphics.Color.parseColor(c.trim()) } catch (e: Exception) { def }
    prefs(ctx).edit()
      .putInt("c_bg", parse(bg, 0xFFFFFFFF.toInt())).putInt("c_ink", parse(ink, 0xFF1D1A2E.toInt()))
      .putInt("c_faint", parse(faint, 0xFF7A7383.toInt())).putInt("c_accent", parse(accent, 0xFFC2331A.toInt()))
      .apply()
  }
  fun color(ctx: Context, key: String, def: Int) = prefs(ctx).getInt(key, def)

  /** The look's link and highlight colours, for notes drawn as the app draws them (Build 46). */
  fun saveTextColors(ctx: Context, link: String, mark: String) {
    fun parse(c: String) = try { android.graphics.Color.parseColor(c.trim()) } catch (e: Exception) { null }
    val e = prefs(ctx).edit()
    parse(link)?.let { e.putInt("c_link", it) }
    parse(mark)?.let { e.putInt("c_mark", it) }
    e.apply()
  }

  /** The colours a row is drawn in. */
  data class Ink(val ink: Int, val faint: Int, val accent: Int, val link: Int, val mark: Int)
  fun ink(ctx: Context): Ink {
    val accent = color(ctx, "c_accent", 0xFFC2331A.toInt())
    return Ink(color(ctx, "c_ink", 0xFF1D1A2E.toInt()), color(ctx, "c_faint", 0xFF7A7383.toInt()), accent,
      color(ctx, "c_link", accent), color(ctx, "c_mark", 0x66FFE066))
  }

  fun vault(ctx: Context): File? = prefs(ctx).getString("vault", null)?.let { File(it) }

  fun todayFile(ctx: Context): File? {
    val p = prefs(ctx)
    val vault = vault(ctx) ?: return null
    val dir = p.getString("dir", "journals") ?: "journals"
    val fmt = p.getString("file", "yyyy_MM_dd") ?: "yyyy_MM_dd"
    // the core's rule (config::journal_rel_path): a name that would leave the journals folder falls
    // back to yyyy_MM_dd; the folder came from the core, already checked to be inside the notes folder
    var stem = format(fmt, Calendar.getInstance())
    if (stem.isEmpty() || stem.startsWith(".") || stem.any { it == '/' || it == '\\' || it == ':' || it == '\u0000' }) stem = format("yyyy_MM_dd", Calendar.getInstance())
    if (dir.split('/', '\\').any { it == ".." } || dir.startsWith("/")) return null
    return File(File(vault, dir), "$stem.md")
  }

  fun todayTitle(ctx: Context): String =
    format(prefs(ctx).getString("title", "MMM do, yyyy") ?: "MMM do, yyyy", Calendar.getInstance())

  /** The pop-up's "to …" line until the app's own code says (LeanCore "where"): today's journal or
   *  the quick capture page, as the app last sent them (setCaptureConfig). Only shown, never used to
   *  find a file: adding goes through the app's own code (LeanCore.capture). */
  fun captureWhere(ctx: Context): String {
    val c = capture(ctx)
    return if (c.optBoolean("today", false)) todayTitle(ctx) else c.optString("page", "quick capture").ifBlank { "quick capture" }
  }

  private fun ordinal(d: Int): String {
    val suf = if (d % 100 in 11..13) "th" else when (d % 10) { 1 -> "st"; 2 -> "nd"; 3 -> "rd"; else -> "th" }
    return "$d$suf"
  }

  /** date-fns style tokens, same rules as core/src/date.rs */
  fun format(fmt: String, c: Calendar): String {
    val y = c.get(Calendar.YEAR)
    val m = c.get(Calendar.MONTH) + 1
    val d = c.get(Calendar.DAY_OF_MONTH)
    val wd = c.get(Calendar.DAY_OF_WEEK) - 1
    val sb = StringBuilder()
    var i = 0
    while (i < fmt.length) {
      if (fmt[i] == '\'') {
        val end = fmt.indexOf('\'', i + 1).let { if (it < 0) fmt.length else it }
        sb.append(fmt, i + 1, end)
        i = end + 1
        continue
      }
      val t = TOKENS.firstOrNull { fmt.startsWith(it, i) }
      if (t == null) { sb.append(fmt[i]); i++; continue }
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
        else -> DAYS[wd].substring(0, 3)
      })
      i += t.length
    }
    return sb.toString()
  }

  // links and pictures: [name](address), ![name](address); an address may hold (balanced) brackets,
  // like "…_(2003)._1678.pdf" or Wikipedia's "…_(disambiguation)". A picture's size, as Logseq writes
  // it right after the link ({:height 200, :width 300}), goes with it.
  private val MD_IMG = Regex("!\\[([^\\]]*)\\]\\(((?:[^()]|\\([^()]*\\))*)\\)(?:\\{\\s*:[^}\\r\\n]*\\})?")
  private val MD_LINK = Regex("\\[([^\\]]*)\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))*)\\)")
  private val WEB = Regex("https?://[^\\s)\\]]+")
  private val MACRO = Regex("\\{\\{([^}]*)\\}\\}")
  private val DRAWER = Regex("^:[A-Za-z-]+:$")
  private val BLOCK_MARK = Regex("^#\\+(BEGIN|END)_\\w*", RegexOption.IGNORE_CASE) // #+BEGIN_NOTE … #+END_NOTE
  private val BLOCK_REF = Regex("\\(\\(([0-9a-fA-F-]{36})\\)\\)") // ((id)): another note, shown as "…"
  // formatting marks, only in pairs around words (so "a == b" stays as it is)
  private val MARKS = listOf("\\*\\*", "__", "~~", "==", "\\^\\^", "`").map { Regex("$it(\\S(?:.*?\\S)??)$it") }

  /** A web address short enough to read: without https://www., cut after 36 characters. */
  private fun shortUrl(u: String): String {
    val s = u.removePrefix("https://").removePrefix("http://").removePrefix("www.").trimEnd('/')
    return if (s.length > 36) s.take(35) + "…" else s
  }

  /** A note as plain words: links show their name (or a short address), pictures and files
   *  their name; page-link brackets and formatting marks go; to-do words become boxes. */
  fun clean(s: String): String {
    if (BLOCK_MARK.containsMatchIn(s.trim())) return "" // the start or end of a box: its lines show as they are
    // a quote, or a coloured box written as a quote ("> [!NOTE] title"): just the words
    var t = s.trim().replace(Regex("^>\\s?"), "").replace(Regex("^\\[!\\w+\\][+-]?\\s*"), "")
    t = MACRO.replace(t) { m -> WEB.find(m.groupValues[1])?.value?.let { shortUrl(it) } ?: "" }
    t = MD_IMG.replace(t) { m -> m.groupValues[1].ifBlank { m.groupValues[2].substringAfterLast('/') } }
    t = MD_LINK.replace(t) { m -> val label = m.groupValues[1]; if (label.isBlank() || WEB.matches(label)) shortUrl(m.groupValues[2]) else label }
    t = WEB.replace(t) { m -> shortUrl(m.value) }
    t = t.replace(Regex("#\\[\\[([^\\]]*)\\]\\]"), "#$1")
      .replace(Regex("\\[\\[([^\\]]*)\\]\\]"), "$1")
      .replace(Regex("^(TODO|LATER|NOW|DOING|WAITING|WAIT|IN-PROGRESS|STARTED) "), "☐ ")
      .replace(Regex("^DONE "), "☑ ")
      .replace(Regex("^(CANCELED|CANCELLED) "), "✕ ")
      .replace(Regex("\\[#[ABCabc]\\]\\s?"), "")
      .replace(Regex("^(☐ |☑ |✕ )?#{1,6}\\s+"), "$1") // a heading's "## "
    t = BLOCK_REF.replace(t, "…")
    for (m in MARKS) t = m.replace(t, "$1")
    return t.replace(Regex("\\s+"), " ").trim()
  }

  /** A file's text, or null if it isn't plain UTF-8 (never rewritten then). */
  fun readUtf8(f: File): String? {
    if (!f.exists()) return ""
    val bytes = f.readBytes()
    return try {
      Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes)).toString()
    } catch (e: Exception) { null }
  }

  /** What the widget lists: to-dos due today (under a heading), then today's notes. */
  fun items(ctx: Context): List<Item> {
    val tasks = try {
      val raw = prefs(ctx).getString("tasks", "[]") ?: "[]"
      val arr = if (raw.trimStart().startsWith("{")) {
        // {day, tasks}: worked out on another day (the app wasn't opened since) means out of date
        val o = JSONObject(raw)
        val c = Calendar.getInstance()
        val day = "${c.get(Calendar.YEAR)}-${c.get(Calendar.MONTH) + 1}-${c.get(Calendar.DAY_OF_MONTH)}"
        if (o.optString("day") == day) o.optJSONArray("tasks") ?: JSONArray() else JSONArray()
      } else JSONArray(raw)
      (0 until arr.length()).map { arr.getJSONObject(it).optString("text").trim() }.filter { clean(it).isNotEmpty() }
    } catch (e: Exception) { emptyList() }
    val notes = notes(ctx)
    val out = mutableListOf<Item>()
    if (tasks.isNotEmpty()) {
      out.add(Item(0, "DUE TODAY", HEADER))
      tasks.forEach { out.add(Item(0, if (MARKER.containsMatchIn(it)) it else "TODO $it", TASK)) }
      if (notes.isNotEmpty()) out.add(Item(0, "NOTES", HEADER))
    }
    return out + notes
  }

  /** Today's journal, one line per note (time-tracking drawers, properties and dates left out). */
  private fun notes(ctx: Context): List<Item> {
    val out = mutableListOf<Item>()
    val f = todayFile(ctx) ?: return out
    if (!f.exists()) return out
    val text = readUtf8(f) ?: return out
    var inFence = false
    var inDrawer = false
    var started = false
    for (raw in text.lines()) {
      val lead = raw.takeWhile { it == ' ' || it == '\t' }
      val rest = raw.substring(lead.length).trimEnd('\r')
      val t = rest.trim()
      if (!inFence && DRAWER.matches(t)) { inDrawer = !t.equals(":END:", ignoreCase = true); continue }
      if (inDrawer) continue
      val depth = lead.count { it == '\t' } + lead.count { it == ' ' } / 2
      val fence = rest.removePrefix("- ").trimStart().startsWith("```")
      val isBullet = rest.startsWith("- ") || rest.startsWith("* ") || rest.startsWith("+ ") || rest == "-"
      if (!inFence && isBullet) {
        out.add(Item(depth, rest.substring(1).trim()))
        started = true
      } else if (!inFence && t.isNotEmpty() && !PROP.containsMatchIn(t) && !t.startsWith("SCHEDULED:") && !t.startsWith("DEADLINE:")) {
        if (!started) { out.add(Item(0, t)); started = true }  // text written outside Logseq
        else if (out.isNotEmpty() && !BLOCK_MARK.containsMatchIn(t)) { val last = out.last(); last.text = (last.text + " " + t).trim() }
      }
      if (fence) inFence = !inFence
    }
    return out.filter { clean(it.text).isNotEmpty() }
  }

  /** A note as the app shows it, as far as a home-screen widget can draw it (Build 46, he asked: "render
   *  my note blocks like it is in the app"): **bold**, *italics*, ~~struck~~, ==highlighted== / ^^…^^,
   *  `code`, headings a size up, page links, #tags and web links in the look's link colour, a to-do word
   *  as a box (a done or cancelled one struck through and faded, as in the app; DOING, NOW, WAITING kept
   *  as a word in the accent). The widget is drawn by the home screen from a few simple parts (text,
   *  pictures, lists), so a picture shows its name, a formula its TeX and a ((reference)) "…". */
  class Drawn(val text: CharSequence, val box: Int, val picture: String?)
  const val BOX_NONE = 0
  const val BOX_OPEN = 1
  const val BOX_DONE = 2
  const val BOX_CANCEL = 3

  /** The same, with the to-do box as a drawing (`box`, Build 46: he asked for the app's graphics, not ☐)
   *  and the note's first picture in the notes folder that `showPicture` takes (it makes the small copy the
   *  row shows): that picture's name is left out of the words, as the app shows the picture, not its link. */
  fun drawn(s: String, c: Ink, showPicture: (String) -> Boolean = { false }): Drawn {
    var box = BOX_NONE
    var shown: String? = null
    val text = styled(s, c, { box = it }) { addr -> if (shown == null && assetName(addr) != null && showPicture(addr)) { shown = addr; true } else false }
    return Drawn(text, box, shown)
  }

  fun styled(s: String, c: Ink): CharSequence = styled(s, c, null, null)

  private fun styled(s: String, c: Ink, boxOut: ((Int) -> Unit)?, picture: ((String) -> Boolean)?): CharSequence {
    val out = SpannableStringBuilder()
    if (BLOCK_MARK.containsMatchIn(s.trim())) return out
    var t = s.trim().replace(Regex("^>\\s?"), "").replace(Regex("^\\[!\\w+\\][+-]?\\s*"), "").replace(Regex("\\s+"), " ")
    var done = false
    MARKER.find(t)?.let { m ->
      val w = m.groupValues[1].uppercase()
      done = w == "DONE" || w.startsWith("CANCEL")
      if (boxOut != null) boxOut(if (w == "DONE") BOX_DONE else if (done) BOX_CANCEL else BOX_OPEN)
      else out.append(if (w == "DONE") "☑ " else if (done) "✕ " else "☐ ")
      if (w in setOf("DOING", "NOW", "WAITING", "WAIT", "IN-PROGRESS", "STARTED")) {
        val a = out.length
        out.append(w).append(' ')
        out.setSpan(ForegroundColorSpan(c.accent), a, a + w.length, EX)
        out.setSpan(StyleSpan(Typeface.BOLD), a, a + w.length, EX)
      }
      t = t.substring(m.range.last + 1)
    }
    t = t.replace(Regex("^\\[#([ABCabc])\\]\\s?"), "")
    val body = out.length
    var head = 0
    Regex("^(#{1,6})\\s+").find(t)?.let { head = it.groupValues[1].length; t = t.substring(it.range.last + 1) }
    inline(t, out, c, picture)
    while (out.isNotEmpty() && out[out.length - 1] == ' ') out.delete(out.length - 1, out.length) // (a picture left out at the end)
    if (head > 0) {
      out.setSpan(StyleSpan(Typeface.BOLD), body, out.length, EX)
      out.setSpan(RelativeSizeSpan(floatArrayOf(1.3f, 1.2f, 1.1f, 1.05f, 1f, 1f)[head - 1]), body, out.length, EX)
    }
    if (done && out.length > body) { // (set last, so the faded colour wins over a link's)
      out.setSpan(StrikethroughSpan(), body, out.length, EX)
      out.setSpan(ForegroundColorSpan(c.faint), body, out.length, EX)
    }
    return out
  }

  private val EX = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
  private val MARKER = Regex("^(TODO|LATER|NOW|DOING|WAITING|WAIT|IN-PROGRESS|STARTED|DONE|CANCELED|CANCELLED) ")
  private val PAGE = Regex("#?\\[\\[([^\\]]*)\\]\\]")
  private val TAG = Regex("(?<![\\w#/])#([^\\s#.,;:!?()\\[\\]{}\"']+)")
  private val CODE = Regex("`([^`]+)`")
  private val MATH = Regex("\\$([^$\\s](?:[^$]*[^$\\s])?)\\$")
  // the paired marks, the longer first: (pattern, what it draws)
  private val PAIRS = listOf("\\*\\*" to "b", "__" to "b", "~~" to "s", "==" to "m", "\\^\\^" to "m", "\\*" to "i", "_" to "i")
    .map { (m, k) -> Regex((if (m == "_") "(?<!\\w)" else "") + "$m(\\S(?:.*?\\S)??)$m" + (if (m == "_") "(?!\\w)" else "")) to k }

  private val PIECES by lazy { listOf("macro" to MACRO, "picture" to MD_IMG, "link" to MD_LINK, "page" to PAGE, "ref" to BLOCK_REF,
    "code" to CODE, "math" to MATH, "web" to WEB, "tag" to TAG) }

  /** The words of a note with their formatting, into `out`: the earliest piece first, then what follows. */
  private fun inline(text: String, out: SpannableStringBuilder, c: Ink, picture: ((String) -> Boolean)? = null) {
    var t = text
    while (t.isNotEmpty()) {
      // every kind of piece, the one starting first wins (at the same place, the order of this list)
      val found = PIECES.mapNotNull { (k, r) -> r.find(t)?.let { k to it } } + PAIRS.mapNotNull { (r, k) -> r.find(t)?.let { k to it } }
      val (kind, m) = found.minByOrNull { it.second.range.first } ?: run { out.append(t); return }
      out.append(t, 0, m.range.first)
      val a = out.length
      fun colour(col: Int) { if (out.length > a) out.setSpan(ForegroundColorSpan(col), a, out.length, EX) }
      when (kind) {
        "macro" -> { WEB.find(m.groupValues[1])?.value?.let { out.append(shortUrl(it)); colour(c.link) } }
        "picture" -> if (picture?.invoke(m.groupValues[2]) != true) { out.append(m.groupValues[1].ifBlank { m.groupValues[2].substringAfterLast('/') }); colour(c.faint) }
        "link" -> { val label = m.groupValues[1]; out.append(if (label.isBlank() || WEB.matches(label)) shortUrl(m.groupValues[2]) else label); colour(c.link) }
        "page" -> { out.append((if (m.value.startsWith("#")) "#" else "") + m.groupValues[1]); colour(c.link) }
        "ref" -> { out.append("…"); colour(c.faint) }
        "code", "math" -> { out.append(m.groupValues[1]); if (out.length > a) out.setSpan(TypefaceSpan("monospace"), a, out.length, EX) }
        "web" -> { out.append(shortUrl(m.value)); colour(c.link) }
        "tag" -> { out.append(m.value); colour(c.link) }
        else -> { // a pair of marks: what's inside may have its own formatting
          inline(m.groupValues[1], out, c, picture)
          if (out.length > a) out.setSpan(when (kind) {
            "b" -> StyleSpan(Typeface.BOLD); "i" -> StyleSpan(Typeface.ITALIC); "s" -> StrikethroughSpan(); else -> BackgroundColorSpan(c.mark)
          }, a, out.length, EX)
        }
      }
      t = t.substring(m.range.last + 1)
    }
  }

  /** A picture's file name in the notes folder's assets/ as the address gives it, or null: only a plain
   *  name right in assets/ (no folder, "..", leading dot or web address), as the app's own rule for
   *  pictures (app::asset_file); "%20" and the like decoded. */
  fun assetName(address: String): String? {
    val a = address.trim().substringBefore('?').substringBefore('#')
    if (a.contains("://")) return null
    val i = a.lastIndexOf("assets/")
    if (i < 0 || (i > 0 && a[i - 1] != '/')) return null
    val name = try { java.net.URLDecoder.decode(a.substring(i + 7).replace("+", "%2B"), "UTF-8") } catch (e: Exception) { return null }
    if (name.isEmpty() || name.startsWith(".") || name.any { it == '/' || it == '\\' || it == '\u0000' }) return null
    return name
  }

  /** A small copy of a picture in the notes folder for a widget row (Build 46, he asked for pictures in
   *  the widget): at most 160 x 72 dp, decoded at about that size and turned as the camera held it.
   *  Android lets a widget's pictures together take about one screenful of memory, so the list keeps
   *  only a few (Factory, THUMBS). Null when it isn't a picture this phone can read. */
  fun thumb(ctx: Context, address: String): Bitmap? {
    val name = assetName(address) ?: return null
    val f = File(File(vault(ctx) ?: return null, "assets"), name)
    if (!f.isFile) return null
    return try {
      val dp = ctx.resources.displayMetrics.density
      val maxW = (160 * dp).toInt()
      val maxH = (72 * dp).toInt()
      val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(f.path, o)
      if (o.outWidth <= 0 || o.outHeight <= 0) return null
      var sample = 1
      while (o.outWidth / (sample * 2) >= maxW && o.outHeight / (sample * 2) >= maxH) sample *= 2
      var b = BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
      val turn = try {
        when (ExifInterface(f.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
          ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f
        }
      } catch (e: Exception) { 0f }
      if (turn != 0f) b = Bitmap.createBitmap(b, 0, 0, b.width, b.height, Matrix().apply { postRotate(turn) }, true)
      val k = minOf(maxW.toFloat() / b.width, maxH.toFloat() / b.height, 1f)
      if (k < 1f) Bitmap.createScaledBitmap(b, maxOf(1, (b.width * k).toInt()), maxOf(1, (b.height * k).toInt()), true) else b
    } catch (e: Throwable) { null } // (a picture too big for memory, or broken: the row shows its name)
  }

  /** One row of the journal widget: a small heading, or a note with its dot or to-do box (drawn), its
   *  words with their formatting and a small picture. `thumbs`: the pictures made so far (by address);
   *  `room`: whether another may be made. Used by the list and by the emulator test (testWidgetText). */
  fun row(ctx: Context, item: Item, c: Ink, thumbs: MutableMap<String, Bitmap?>, room: () -> Boolean): RemoteViews {
    val rv = RemoteViews(ctx.packageName, R.layout.widget_item)
    val dp = ctx.resources.displayMetrics.density
    if (item.kind == HEADER) { // "DUE TODAY", "NOTES": small and pale, no dot
      rv.setViewVisibility(R.id.item_mark, View.GONE)
      rv.setTextViewText(R.id.item_text, item.text)
      rv.setTextColor(R.id.item_text, c.faint)
      rv.setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, 11f)
      rv.setViewPadding(R.id.item_root, 0, ((if (item.depth < 0) 0 else 10) * dp).toInt(), 0, (2 * dp).toInt())
    } else {
      val d = drawn(item.text, c) { addr ->
        if (addr !in thumbs && room()) thumbs[addr] = thumb(ctx, addr)
        thumbs[addr] != null
      }
      val (mark, tint) = when (d.box) {
        BOX_OPEN -> R.drawable.widget_box_open to c.faint
        BOX_DONE -> R.drawable.widget_box_done to c.accent
        BOX_CANCEL -> R.drawable.widget_box_cancel to c.faint
        else -> R.drawable.widget_dot to c.faint
      }
      rv.setImageViewResource(R.id.item_mark, mark)
      rv.setInt(R.id.item_mark, "setColorFilter", tint)
      rv.setTextViewText(R.id.item_text, d.text)
      rv.setViewVisibility(R.id.item_text, if (d.text.isEmpty()) View.GONE else View.VISIBLE)
      rv.setTextColor(R.id.item_text, c.ink)
      rv.setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, 14f)
      val pic = d.picture?.let { thumbs[it] }
      if (pic != null) { rv.setImageViewBitmap(R.id.item_pic, pic); rv.setViewVisibility(R.id.item_pic, View.VISIBLE) }
      rv.setViewPadding(R.id.item_root, (item.depth * 16 * dp).toInt(), (3 * dp).toInt(), 0, (3 * dp).toInt())
    }
    rv.setOnClickFillInIntent(R.id.item_root, Intent())
    return rv
  }

  /** Text colour that reads on top of colour c: white on dark colours, near-black on light ones. */
  fun onColor(c: Int): Int {
    val r = android.graphics.Color.red(c) / 255.0; val g = android.graphics.Color.green(c) / 255.0; val b = android.graphics.Color.blue(c) / 255.0
    return if (0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6) 0xFF15171C.toInt() else 0xFFFFFFFF.toInt()
  }
  /** Colour a mixed with t (0..1) of colour b. */
  fun mix(a: Int, b: Int, t: Double): Int {
    fun ch(x: Int, y: Int) = (x + (y - x) * t).toInt().coerceIn(0, 255)
    return android.graphics.Color.rgb(ch(android.graphics.Color.red(a), android.graphics.Color.red(b)),
      ch(android.graphics.Color.green(a), android.graphics.Color.green(b)), ch(android.graphics.Color.blue(a), android.graphics.Color.blue(b)))
  }

  /** First web address in the text (bare, or a Markdown link to one, `[name](https://…)`), and the
   *  rest without it (as outline_core::capture::split_url). */
  fun splitUrl(s: String): Pair<String, String> {
    val bare = listOf(s.indexOf("https://"), s.indexOf("http://")).filter { it >= 0 }.minOrNull()
    val md = mdLinkAt(s)
    if (md != null && (bare == null || md.first < bare)) {
      return tidyRest(s.substring(0, md.first) + s.substring(md.second)) to s.substring(md.first, md.second)
    }
    val i = bare ?: return s.trim() to ""
    var end = i
    while (end < s.length && !s[end].isWhitespace()) end++
    val url = s.substring(i, end).trimEnd('.', ',', ';', ')', '"', '\'')
    return tidyRest(s.substring(0, i) + s.substring(i + url.length)) to url
  }

  private fun tidyRest(r: String) = r.trim().trimEnd(':', '-', '—', '|').trim()

  /** Where the first `[name](http…)` link in s is (start, end), as outline_core's md_link_at. */
  private fun mdLinkAt(s: String): Pair<Int, Int>? {
    var from = 0
    while (true) {
      val a = s.indexOf('[', from)
      if (a < 0) return null
      val c = s.indexOf("](", a)
      if (c >= 0) {
        val label = s.substring(a + 1, c)
        val tail = s.substring(c + 2)
        if (label.none { it == '[' || it == ']' || it == '\n' } && (tail.startsWith("https://") || tail.startsWith("http://"))) {
          var depth = 0
          for ((i, ch) in tail.withIndex()) {
            if (ch.isWhitespace()) break
            if (ch == '(') depth++
            else if (ch == ')') { if (depth == 0) return a to (c + 2 + i + 1); depth-- }
          }
        }
      }
      from = a + 1
    }
  }

  /** The site's address without https://, www., a port or a path (as outline_core's host). */
  fun host(url: String): String {
    val rest = url.substringAfter("://", url)
    var h = rest.split('/', '?', '#').first()
    h = h.substringAfterLast('@').substringBefore(':')
    return h.removePrefix("www.").lowercase()
  }

  /** A neat Markdown link, "[Title · site](url)", or "[site](url)" with no title (as outline_core's
   *  md_link, for a shared page: Android gives its title, not the site's own name). */
  fun mdLink(url: String, title: String): String {
    val u = url.trim()
    if (u.isEmpty()) return ""
    val place = host(u)
    var t = title.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
    for (sep in listOf(" | ", " - ", " – ", " — ", " · ", " : ", " :: ", " / ")) {
      val i = t.lastIndexOf(sep)
      if (i > 0) {
        val tail = t.substring(i + sep.length).trim().lowercase()
        if (tail == place || tail.replace(" ", "") == place.substringBefore('.')) { t = t.substring(0, i).trim(); break }
      }
    }
    val name = (if (t.isEmpty() || t.equals(place, ignoreCase = true)) place else "$t · $place").ifEmpty { u }
      .replace('[', '(').replace(']', ')').replace('\n', ' ')
    return "[$name](${u.replace(" ", "%20").replace("(", "%28").replace(")", "%29")})"
  }

  fun refresh(ctx: Context) {
    val mgr = AppWidgetManager.getInstance(ctx)
    for (id in mgr.getAppWidgetIds(ComponentName(ctx, QuickAddWidget::class.java))) QuickAddWidget.update(ctx, mgr, id)
    val ids = mgr.getAppWidgetIds(ComponentName(ctx, JournalWidget::class.java))
    if (ids.isEmpty()) return
    for (id in ids) JournalWidget.update(ctx, mgr, id)
    mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list)
  }
}

class JournalWidget : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    for (id in ids) update(ctx, mgr, id)
    mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list)
  }

  companion object {
    /** The app's look on the widget (the colours it sent last, setWidgetColors); the system rounds
     *  the corners of @android:id/background. (Also what the emulator test checks:
     *  MainActivity's testWidgetColors.) */
    fun paint(ctx: Context, rv: RemoteViews) {
      rv.setInt(android.R.id.background, "setBackgroundColor", Journal.color(ctx, "c_bg", 0xFFFFFFFF.toInt()))
      rv.setTextColor(R.id.widget_title, Journal.color(ctx, "c_ink", 0xFF1D1A2E.toInt()))
      rv.setTextColor(R.id.widget_empty, Journal.color(ctx, "c_faint", 0xFF7A7383.toInt()))
      rv.setTextColor(R.id.widget_add, Journal.color(ctx, "c_accent", 0xFFC2331A.toInt()))
    }

    fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val rv = RemoteViews(ctx.packageName, R.layout.widget_journal)
      rv.setTextViewText(R.id.widget_title, Journal.todayTitle(ctx))
      paint(ctx, rv)
      val svc = Intent(ctx, JournalWidgetService::class.java)
      svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
      svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
      rv.setRemoteAdapter(R.id.widget_list, svc)
      rv.setEmptyView(R.id.widget_list, R.id.widget_empty)
      val immutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val mutable = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
      val openApp = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val openPi = PendingIntent.getActivity(ctx, 0, openApp, immutable)
      rv.setOnClickPendingIntent(R.id.widget_title, openPi)
      rv.setOnClickPendingIntent(R.id.widget_logo, openPi) // (thinky's icon before the day)
      rv.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(ctx, 2, openApp, mutable))
      val add = Intent(ctx, QuickCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val addPi = PendingIntent.getActivity(ctx, 1, add, immutable)
      rv.setOnClickPendingIntent(R.id.widget_add, addPi)
      rv.setOnClickPendingIntent(R.id.widget_empty, addPi)
      mgr.updateAppWidget(id, rv)
    }
  }
}

class JournalWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

  class Factory(private val ctx: Context) : RemoteViewsFactory {
    /** At most this many small pictures in the list at once: each is up to 160 x 72 dp, so six stay far
     *  inside the memory Android allows a widget's pictures (about one screenful). */
    private val THUMBS = 6
    private var items: List<Journal.Item> = emptyList()
    private var ink = 0xFF1D1A2E.toInt()
    private var faint = 0xFF7A7383.toInt()
    private var colours: Journal.Ink? = null
    private val thumbs = HashMap<String, Bitmap?>() // small pictures made for the rows, by address
    override fun onCreate() {}
    override fun onDataSetChanged() {
      items = try { Journal.items(ctx) } catch (e: Exception) { emptyList() }
      ink = Journal.color(ctx, "c_ink", ink)
      faint = Journal.color(ctx, "c_faint", faint)
      colours = Journal.ink(ctx)
      thumbs.clear() // (made again as the rows are drawn: a picture may have changed)
    }
    override fun onDestroy() {}
    override fun getCount(): Int = items.size
    override fun getViewAt(position: Int): RemoteViews {
      val item = items.getOrNull(position) ?: return RemoteViews(ctx.packageName, R.layout.widget_item)
      // the first heading sits at the top (depth -1 marks it: no space above)
      val shown = if (item.kind == Journal.HEADER && position == 0) Journal.Item(-1, item.text, item.kind) else item
      return Journal.row(ctx, shown, colours ?: Journal.ink(ctx), thumbs) { thumbs.size < THUMBS }
    }
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false
  }
}

/** A one-tap "+" for the home screen (1 x 1): opens the "Add a note" pop-up straight away. */
class QuickAddWidget : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    for (id in ids) update(ctx, mgr, id)
  }

  companion object {
    /** The look's accent colour on the circle, the plus in white or near-black to read on it. */
    fun paint(ctx: Context, rv: RemoteViews) {
      val accent = Journal.color(ctx, "c_accent", 0xFFC2331A.toInt())
      rv.setInt(R.id.qa_circle, "setColorFilter", accent)
      rv.setInt(R.id.qa_plus, "setColorFilter", Journal.onColor(accent))
    }

    fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val rv = RemoteViews(ctx.packageName, R.layout.widget_quick_add)
      paint(ctx, rv)
      val add = Intent(ctx, QuickCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      rv.setOnClickPendingIntent(R.id.qa_root, PendingIntent.getActivity(ctx, 3, add, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      mgr.updateAppWidget(id, rv)
    }
  }
}
