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
    private var items: List<Journal.Item> = emptyList()
    private var ink = 0xFF1D1A2E.toInt()
    private var faint = 0xFF7A7383.toInt()
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
