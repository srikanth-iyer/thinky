// Home-screen widget showing today's journal (and to-dos due today), plus quick capture
// helpers shared with QuickCaptureActivity. The package line is added by scripts/android_overlay.py.

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
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
  const val DEFAULT_TEXT = "[[quick capture]] **{time}**: {text} from {url}"
  const val DEFAULT_MEDIA = "[[quick capture]] **{time}**: {url}"

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

  /** Quick capture format from config.edn (as JSON: text, media, today, page, pagesDir, oneTap). */
  fun saveCapture(ctx: Context, json: String) { prefs(ctx).edit().putString("capture", json).apply() }
  private fun capture(ctx: Context): JSONObject = try { JSONObject(prefs(ctx).getString("capture", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
  fun oneTap(ctx: Context): Boolean = capture(ctx).optBoolean("oneTap", false)

  /** To-dos due today, sent by the app: JSON {day: "2026-10-26", tasks: [{text, page}]}. */
  fun saveTasks(ctx: Context, json: String) { prefs(ctx).edit().putString("tasks", json).apply() }

  /** Colours of the app's current look (sent by the app whenever the look changes). */
  fun saveColors(ctx: Context, bg: String, ink: String, faint: String, accent: String) {
    fun parse(c: String, def: Int) = try { android.graphics.Color.parseColor(c.trim()) } catch (e: Exception) { def }
    prefs(ctx).edit()
      .putInt("c_bg", parse(bg, 0xFFFFFFFF.toInt())).putInt("c_ink", parse(ink, 0xFF1A2130.toInt()))
      .putInt("c_faint", parse(faint, 0xFF8A93A2.toInt())).putInt("c_accent", parse(accent, 0xFF0B7B66.toInt()))
      .apply()
  }
  fun color(ctx: Context, key: String, def: Int) = prefs(ctx).getInt(key, def)

  fun vault(ctx: Context): File? = prefs(ctx).getString("vault", null)?.let { File(it) }

  fun todayFile(ctx: Context): File? {
    val p = prefs(ctx)
    val vault = vault(ctx) ?: return null
    val dir = p.getString("dir", "journals") ?: "journals"
    val fmt = p.getString("file", "yyyy_MM_dd") ?: "yyyy_MM_dd"
    return File(File(vault, dir), format(fmt, Calendar.getInstance()) + ".md")
  }

  fun todayTitle(ctx: Context): String =
    format(prefs(ctx).getString("title", "MMM do, yyyy") ?: "MMM do, yyyy", Calendar.getInstance())

  /** Where captures go: today's journal, or the capture page (:quick-capture-options). */
  fun captureTarget(ctx: Context): Pair<File, String>? {
    val c = capture(ctx)
    if (c.optBoolean("today", false)) { val f = todayFile(ctx) ?: return null; return f to todayTitle(ctx) }
    val vault = vault(ctx) ?: return null
    val page = c.optString("page", "quick capture").ifBlank { "quick capture" }
    val dir = File(vault, c.optString("pagesDir", "pages"))
    val stem = fileStem(page)
    // reuse a file whose name differs only in capitals
    val existing = dir.listFiles()?.firstOrNull { it.name.endsWith(".md") && it.name.removeSuffix(".md").equals(stem, ignoreCase = true) }
    return (existing ?: File(dir, "$stem.md")) to page
  }

  /** Logseq's file name for a page (same rules as outline_core::file_stem_for). */
  fun fileStem(name: String): String {
    var s = name.removePrefix("/").removeSuffix("/")
    val sb = StringBuilder()
    var i = 0
    while (i < s.length) {
      val c = s[i]
      if (c == '%' && i + 2 < s.length && s[i + 1].isHex() && s[i + 2].isHex()) sb.append("%25")
      else if (":*?\"<>|#\\".indexOf(c) >= 0) sb.append(String.format(Locale.US, "%%%02X", c.code))
      else sb.append(c)
      i++
    }
    s = sb.toString()
    if (s.startsWith(".")) s = "%2E" + s.substring(1)
    val reserved = setOf("CON", "PRN", "AUX", "NUL") + (1..9).flatMap { listOf("COM$it", "LPT$it") }
    if (s in reserved || s.endsWith(".")) s += "/"
    return s.replace("___", "%5F%5F%5F").replace("_/", "%5F/").replace("/_", "/%5F").replace("/", "___")
  }
  private fun Char.isHex() = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

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
  // like "…_(2003)._1678.pdf" or Wikipedia's "…_(disambiguation)"
  private val MD_IMG = Regex("!\\[([^\\]]*)\\]\\(((?:[^()]|\\([^()]*\\))*)\\)")
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
      (0 until arr.length()).map { clean(arr.getJSONObject(it).optString("text")) }.filter { it.isNotEmpty() }
    } catch (e: Exception) { emptyList() }
    val notes = notes(ctx)
    val out = mutableListOf<Item>()
    if (tasks.isNotEmpty()) {
      out.add(Item(0, "DUE TODAY", HEADER))
      tasks.forEach { out.add(Item(0, if (it.startsWith("☐")) it else "☐ $it", TASK)) }
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
        out.add(Item(depth, clean(rest.substring(1).trim())))
        started = true
      } else if (!inFence && t.isNotEmpty() && !PROP.containsMatchIn(t) && !t.startsWith("SCHEDULED:") && !t.startsWith("DEADLINE:")) {
        if (!started) { out.add(Item(0, clean(t))); started = true }  // text written outside Logseq
        else if (out.isNotEmpty()) { val last = out.last(); last.text = (last.text + " " + clean(t)).trim() }
      }
      if (fence) inFence = !inFence
    }
    return out.filter { it.text.isNotEmpty() }
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

  /** First web address in the text, and the rest without it (as outline_core::capture::split_url). */
  fun splitUrl(s: String): Pair<String, String> {
    val i = listOf(s.indexOf("https://"), s.indexOf("http://")).filter { it >= 0 }.minOrNull() ?: return s.trim() to ""
    var end = i
    while (end < s.length && !s[end].isWhitespace()) end++
    val url = s.substring(i, end).trimEnd('.', ',', ';', ')', '"', '\'')
    val rest = (s.substring(0, i) + s.substring(i + url.length)).trim().trimEnd(':', '-', '—', '|').trim()
    return rest to url
  }

  /** Words that only join a value to the text before it ("… from {url}"): dropped with an empty value. */
  private val JOINERS = listOf("from", "via", "at", "on", "-", "–", "—", "|", "·")

  /** Fill a capture template: {time} {date} {text} {url}; empty values take a space (and a
   *  joining word in front) with them. Same rules as outline_core::capture::fill. */
  fun fill(template: String, text: String, url: String, date: String): String {
    val c = Calendar.getInstance()
    val time = String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
    val values = mapOf("{time}" to time, "{date}" to date, "{text}" to text.trim(), "{url}" to url.trim())
    var t = template
    for ((k, v) in values) if (v.isEmpty()) {
      for (j in JOINERS) t = t.replace(" $j $k", "")
      t = t.replace(" $k", "").replace("$k ", "").replace(k, "")
    }
    val sb = StringBuilder()
    var i = 0
    while (i < t.length) {
      val hit = if (t[i] == '{') values.keys.firstOrNull { t.startsWith(it, i) } else null
      if (hit != null) { sb.append(values[hit]); i += hit.length } else { sb.append(t[i]); i++ }
    }
    return sb.toString().trim()
  }

  /** A capture that couldn't be added, with a reason to show. */
  class CaptureError(message: String) : Exception(message)

  /** Shared or typed text → a bullet in the quick capture format. Returns where it went. */
  fun captureText(ctx: Context, text: String): String {
    val c = capture(ctx)
    val (t, u) = splitUrl(text)
    return add(ctx, fill(c.optString("text", DEFAULT_TEXT).ifBlank { DEFAULT_TEXT }, t, u, todayTitle(ctx)))
  }

  /** A shared picture (already copied into assets) → a bullet in the media format. */
  fun captureMedia(ctx: Context, link: String): String {
    val c = capture(ctx)
    return add(ctx, fill(c.optString("media", DEFAULT_MEDIA).ifBlank { DEFAULT_MEDIA }, "", link, todayTitle(ctx)))
  }

  private fun add(ctx: Context, line: String): String {
    if (line.isBlank()) throw CaptureError("Nothing to add")
    val (f, name) = captureTarget(ctx) ?: throw CaptureError("Open Lean Outliner once and choose your notes folder first")
    append(f, line)
    refresh(ctx)
    return name
  }

  /** Same rules as outline_core::append_bullet: keeps CRLF and a byte-order mark. Written to a
   *  hidden temp file in the same folder, flushed to disk, then renamed over the original, and
   *  only if the file didn't change in between (a sync app may be writing it right then). */
  fun append(f: File, text: String) {
    val dir = f.parentFile ?: throw CaptureError("Couldn't find the folder for ${f.name}")
    dir.mkdirs()
    for (attempt in 1..3) {
      val stampBefore = f.lastModified() to f.length() // (0, 0) when the file isn't there yet
      var cur = readUtf8(f) ?: throw CaptureError("${f.name} isn't plain UTF-8 text, so nothing was added")
      val bom = if (cur.startsWith("\uFEFF")) "\uFEFF" else ""
      cur = cur.removePrefix("\uFEFF")
      val nl = if (cur.contains("\r\n")) "\r\n" else "\n"
      // drop trailing line breaks and blank last lines, nothing else
      while (true) {
        val t = cur.trimEnd('\n', '\r')
        val last = t.substring(t.lastIndexOf('\n') + 1)
        if (t.isNotEmpty() && last.isBlank()) cur = t.substring(0, t.length - last.length) else { cur = t; break }
      }
      if (cur.trim() == "-") cur = ""
      val sb = StringBuilder(cur)
      if (sb.isNotEmpty()) sb.append(nl)
      val lines = text.replace("\r\n", "\n").trimEnd('\n').split('\n')
      sb.append("- ").append(lines[0])
      for (l in lines.drop(1)) { sb.append(nl); if (l.isNotEmpty()) sb.append("  ").append(l) }
      sb.append(nl)
      val out = (bom + sb.toString()).toByteArray(Charsets.UTF_8)
      val tmp = File.createTempFile(".capture-", ".tmp", dir) // hidden name: the app ignores it
      try {
        java.io.FileOutputStream(tmp).use { os -> os.write(out); os.fd.sync() }
        if ((f.lastModified() to f.length()) != stampBefore) { tmp.delete(); continue } // changed meanwhile: start over
        if (!tmp.renameTo(f)) throw CaptureError("Couldn't save ${f.name}")
        return
      } catch (e: CaptureError) {
        tmp.delete(); throw e
      } catch (e: Exception) {
        tmp.delete(); throw CaptureError("Couldn't save ${f.name}: ${e.message ?: e.javaClass.simpleName}")
      }
    }
    throw CaptureError("${f.name} kept changing (is it syncing?). Try again in a moment")
  }

  /** Copy a shared file into the vault's assets folder. Returns the link path (../assets/…). */
  fun saveAsset(ctx: Context, uri: Uri, name: String): String {
    val vault = vault(ctx) ?: throw CaptureError("Open Lean Outliner once and choose your notes folder first")
    val dir = File(vault, "assets").apply { mkdirs() }
    val dot = name.lastIndexOf('.')
    val stem = (if (dot > 0) name.substring(0, dot) else name).map { if (it.isLetterOrDigit() || it == '-' || it == '_') it else '_' }
      .joinToString("").trim('_').take(60).ifEmpty { "image" }
    val ext = if (dot > 0) name.substring(dot + 1).lowercase(Locale.US).filter { it.isLetterOrDigit() } else "png"
    val file = File(dir, "${stem}_${System.currentTimeMillis()}.$ext")
    try {
      val input = ctx.contentResolver.openInputStream(uri) ?: throw CaptureError("Couldn't open the picture")
      input.use { i -> file.outputStream().use { i.copyTo(it) } }
      return "../assets/${file.name}"
    } catch (e: CaptureError) {
      file.delete(); throw e
    } catch (e: Exception) {
      file.delete(); throw CaptureError("Couldn't copy the picture: ${e.message ?: e.javaClass.simpleName}")
    }
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
    fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val rv = RemoteViews(ctx.packageName, R.layout.widget_journal)
      rv.setTextViewText(R.id.widget_title, Journal.todayTitle(ctx))
      // follow the app's look; the system rounds the corners of @android:id/background
      rv.setInt(android.R.id.background, "setBackgroundColor", Journal.color(ctx, "c_bg", 0xFFFFFFFF.toInt()))
      rv.setTextColor(R.id.widget_title, Journal.color(ctx, "c_ink", 0xFF1A2130.toInt()))
      rv.setTextColor(R.id.widget_empty, Journal.color(ctx, "c_faint", 0xFF8A93A2.toInt()))
      rv.setTextColor(R.id.widget_add, Journal.color(ctx, "c_accent", 0xFF0B7B66.toInt()))
      val svc = Intent(ctx, JournalWidgetService::class.java)
      svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
      svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
      rv.setRemoteAdapter(R.id.widget_list, svc)
      rv.setEmptyView(R.id.widget_list, R.id.widget_empty)
      val immutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val mutable = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
      val openApp = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      rv.setOnClickPendingIntent(R.id.widget_title, PendingIntent.getActivity(ctx, 0, openApp, immutable))
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
    private var items: List<Journal.Item> = emptyList()
    private var ink = 0xFF1A2130.toInt()
    private var faint = 0xFF8A93A2.toInt()
    override fun onCreate() {}
    override fun onDataSetChanged() {
      items = try { Journal.items(ctx) } catch (e: Exception) { emptyList() }
      ink = Journal.color(ctx, "c_ink", ink)
      faint = Journal.color(ctx, "c_faint", faint)
    }
    override fun onDestroy() {}
    override fun getCount(): Int = items.size
    override fun getViewAt(position: Int): RemoteViews {
      val rv = RemoteViews(ctx.packageName, R.layout.widget_item)
      val item = items.getOrNull(position) ?: return rv
      val dp = ctx.resources.displayMetrics.density
      if (item.kind == Journal.HEADER) { // "DUE TODAY", "NOTES": small and pale
        rv.setTextViewText(R.id.item_text, item.text)
        rv.setTextColor(R.id.item_text, faint)
        rv.setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, 11f)
        rv.setViewPadding(R.id.item_text, 0, ((if (position == 0) 0 else 10) * dp).toInt(), 0, (2 * dp).toInt())
      } else {
        val box = item.text.startsWith("☐") || item.text.startsWith("☑") || item.text.startsWith("✕")
        rv.setTextViewText(R.id.item_text, if (item.kind == Journal.TASK || box) item.text else "•  " + item.text)
        rv.setTextColor(R.id.item_text, ink)
        rv.setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, 14f)
        rv.setViewPadding(R.id.item_text, (item.depth * 16 * dp).toInt(), (3 * dp).toInt(), 0, (3 * dp).toInt())
      }
      rv.setOnClickFillInIntent(R.id.item_text, Intent())
      return rv
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
    fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val rv = RemoteViews(ctx.packageName, R.layout.widget_quick_add)
      val accent = Journal.color(ctx, "c_accent", 0xFF0B7B66.toInt())
      rv.setInt(R.id.qa_circle, "setColorFilter", accent) // the look's colour
      rv.setInt(R.id.qa_plus, "setColorFilter", Journal.onColor(accent))
      val add = Intent(ctx, QuickCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      rv.setOnClickPendingIntent(R.id.qa_root, PendingIntent.getActivity(ctx, 3, add, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      mgr.updateAppWidget(id, rv)
    }
  }
}
