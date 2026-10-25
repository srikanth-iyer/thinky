// Home-screen widget showing today's journal, plus helpers shared with QuickCaptureActivity.
// The package line is added by scripts/android_overlay.py.

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.io.File
import java.util.Calendar
import java.util.Locale

/** Where today's journal lives, and how to read/append it. Settings come from the app (setWidgetConfig). */
object Journal {
  private const val PREFS = "lean_widget"
  private val MONTHS = arrayOf("January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December")
  private val DAYS = arrayOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
  private val TOKENS = listOf("yyyy", "yy", "MMMM", "MMM", "MM", "M", "do", "dd", "d", "EEEE", "EEE", "EE", "E")
  private val PROP = Regex("^[\\w.\\-/]+::")

  data class Item(val depth: Int, var text: String)

  fun save(ctx: Context, vault: String, journalsDir: String, fileFormat: String, titleFormat: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("vault", vault).putString("dir", journalsDir)
      .putString("file", fileFormat).putString("title", titleFormat).apply()
  }

  fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Colours of the app's current look (sent by the app whenever the look changes). */
  fun saveColors(ctx: Context, bg: String, ink: String, faint: String, accent: String) {
    fun parse(c: String, def: Int) = try { android.graphics.Color.parseColor(c.trim()) } catch (e: Exception) { def }
    prefs(ctx).edit()
      .putInt("c_bg", parse(bg, 0xFFFFFFFF.toInt())).putInt("c_ink", parse(ink, 0xFF1A2130.toInt()))
      .putInt("c_faint", parse(faint, 0xFF8A93A2.toInt())).putInt("c_accent", parse(accent, 0xFF0B7B66.toInt()))
      .apply()
  }
  fun color(ctx: Context, key: String, def: Int) = prefs(ctx).getInt(key, def)

  fun todayFile(ctx: Context): File? {
    val p = prefs(ctx)
    val vault = p.getString("vault", null) ?: return null
    val dir = p.getString("dir", "journals") ?: "journals"
    val fmt = p.getString("file", "yyyy_MM_dd") ?: "yyyy_MM_dd"
    return File(File(vault, dir), format(fmt, Calendar.getInstance()) + ".md")
  }

  fun todayTitle(ctx: Context): String =
    format(prefs(ctx).getString("title", "MMM do, yyyy") ?: "MMM do, yyyy", Calendar.getInstance())

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

  private fun clean(s: String): String = s
    .replace(Regex("#\\[\\[([^\\]]*)\\]\\]"), "#$1")
    .replace(Regex("\\[\\[([^\\]]*)\\]\\]"), "$1")
    .replace(Regex("^(TODO|LATER|NOW|DOING|WAITING) "), "☐ ")
    .replace(Regex("^DONE "), "☑ ")
    .replace("**", "")

  fun items(ctx: Context): List<Item> {
    val f = todayFile(ctx) ?: return emptyList()
    if (!f.exists()) return emptyList()
    val out = mutableListOf<Item>()
    var inFence = false
    for (raw in f.readLines()) {
      val lead = raw.takeWhile { it == ' ' || it == '\t' }
      val rest = raw.substring(lead.length)
      val depth = lead.count { it == '\t' } + lead.count { it == ' ' } / 2
      val fence = rest.removePrefix("- ").trimStart().startsWith("```")
      val isBullet = rest.startsWith("- ") || rest.startsWith("* ") || rest.startsWith("+ ") || rest == "-"
      if (!inFence && isBullet) {
        out.add(Item(depth, clean(rest.substring(1).trim())))
      } else if (!inFence && out.isEmpty() && rest.isNotBlank() && !PROP.containsMatchIn(rest.trim())) {
        out.add(Item(0, clean(rest.trim())))  // text written outside Logseq, before any bullet
      } else if (!inFence && out.isNotEmpty() && rest.isNotBlank() && !PROP.containsMatchIn(rest.trim())) {
        val last = out.last()
        last.text = (last.text + " " + clean(rest.trim())).trim()
      }
      if (fence) inFence = !inFence
    }
    return out.filter { it.text.isNotEmpty() }
  }

  /** Same rules as outline_core::append_bullet. */
  fun append(ctx: Context, text: String): Boolean {
    val f = todayFile(ctx) ?: return false
    f.parentFile?.mkdirs()
    var cur = if (f.exists()) f.readText() else ""
    cur = cur.trimEnd('\n', '\r', ' ', '\t')
    if (cur.trim() == "-") cur = ""
    val sb = StringBuilder(cur)
    if (sb.isNotEmpty()) sb.append('\n')
    val lines = text.replace("\r", "").trimEnd('\n').split('\n')
    sb.append("- ").append(lines[0])
    for (l in lines.drop(1)) sb.append("\n  ").append(l)
    sb.append('\n')
    f.writeText(sb.toString())
    refresh(ctx)
    return true
  }

  fun refresh(ctx: Context) {
    val mgr = AppWidgetManager.getInstance(ctx)
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
    override fun onCreate() {}
    override fun onDataSetChanged() {
      items = try { Journal.items(ctx) } catch (e: Exception) { emptyList() }
      ink = Journal.color(ctx, "c_ink", ink)
    }
    override fun onDestroy() {}
    override fun getCount(): Int = items.size
    override fun getViewAt(position: Int): RemoteViews {
      val rv = RemoteViews(ctx.packageName, R.layout.widget_item)
      val item = items.getOrNull(position) ?: return rv
      rv.setTextViewText(R.id.item_text, "•  " + item.text)
      rv.setTextColor(R.id.item_text, ink)
      val pad = (item.depth * 16 * ctx.resources.displayMetrics.density).toInt()
      rv.setViewPadding(R.id.item_text, pad, 3, 0, 3)
      rv.setOnClickFillInIntent(R.id.item_text, Intent())
      return rv
    }
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false
  }
}
