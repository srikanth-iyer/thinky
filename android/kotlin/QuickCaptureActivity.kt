// Small pop-up for adding a note: opened by the widgets' + buttons, or by sharing text or a
// picture from another app ("Add to journal" in the share menu). Uses Logseq's quick capture
// format from config.edn. Every share shows the pop-up first: nothing is added until Add is
// tapped, so another app can never add notes by itself (the no-pop-up setting went in Build 34).
// Looks like the app: a small rounded card near the bottom of the screen in the colours of the look
// the app last used (sent with setWidgetColors). Build 39 (he picked "A · compact composer"): a small
// "to …" line, the words, then one row of tool chips (each its own fill and edge, 6dp apart) and a
// round Add, greyed until there's something to add; a shared picture shows as a preview.
// Adding goes through the app's own code (LeanCore → src-tauri/src/android_capture.rs →
// outline_core::capture), on a helper thread; if that fails the pop-up stays open with the reason
// and the text, so nothing typed is lost. A tap outside closes it only while there's nothing to add,
// and turning the phone keeps it as it is (the manifest's configChanges; a note being added is never
// added twice). Another app's picture is checked away from the screen's thread (asking its
// provider may take a while), and its preview read with a limit, whatever size that app says.
// The package line is added by scripts/android_overlay.py.

import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.io.ByteArrayInputStream

class QuickCaptureActivity : AppCompatActivity() {
  companion object {
    /** A note is being added (by any pop-up of this app): the next Add waits for it, so the same
     *  note is never added twice, also when Android made the pop-up again meanwhile. */
    private val adding = java.util.concurrent.atomic.AtomicBoolean(false)
    /** The most a preview reads of a shared picture (a bigger one gets no preview, and is still added). */
    private const val PREVIEW_MAX = 40_000_000
  }
  private var image: Uri? = null
  private var busy = false
  /** Where notes go, for the "to …" line and the message after adding. */
  @Volatile private var where = ""
  /** The word a to-do starts with there (TODO, or LATER with :preferred-workflow :now: LeanCore.where). */
  @Volatile private var todoWord = "TODO"
  /** A shared picture already copied into assets/ by a try that then failed (its Markdown). */
  @Volatile private var savedLink: String? = null

  override fun onSaveInstanceState(out: Bundle) {
    super.onSaveInstanceState(out)
    savedLink?.let { out.putString("savedLink", it) }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    savedLink = savedInstanceState?.getString("savedLink")
    supportRequestWindowFeature(android.view.Window.FEATURE_NO_TITLE) // our own heading says where it goes
    setContentView(R.layout.activity_quick_capture)
    setFinishOnTouchOutside(true) // (until there's something to add: addState)
    // a card near the bottom, full width with a margin (less wide on tablets), softly dimmed behind
    window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    window.setGravity(Gravity.BOTTOM)
    window.setDimAmount(0.3f)
    paint()
    val input = findViewById<EditText>(R.id.qc_input)
    where = try { Journal.captureWhere(this) } catch (e: Exception) { Journal.todayTitle(this) }
    findViewById<TextView>(R.id.qc_where).text = whereLine()
    // the app's own code says where notes go now (config.edn as it is); this also loads it early,
    // so Add is quick, and a problem shows before anything is typed
    Thread {
      val w: Result<Pair<String, String>> = try { Result.success(LeanCore.where(applicationContext)) } catch (e: Throwable) { Result.failure(e) }
      runOnUiThread {
        if (isFinishing) return@runOnUiThread
        w.fold(
          onSuccess = { (page, todo) ->
            todoWord = todo
            if (page.isNotEmpty()) { where = page; findViewById<TextView>(R.id.qc_where).text = whereLine() }
          },
          onFailure = { e -> if (!busy) showError(e.message ?: "Couldn't start the part of the app that adds notes.") },
        )
      }
    }.start()
    // buttons first, so the pop-up always works (also when a one-tap share fails below)
    findViewById<ImageButton>(R.id.qc_paste).setOnClickListener {
      val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
      val clip = cm.primaryClip
      val t = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this)?.toString() else null
      if (!t.isNullOrEmpty()) input.text.insert(maxOf(0, input.selectionStart), t)
    }
    findViewById<ImageButton>(R.id.qc_add).setOnClickListener { add(input.text.toString()) }
    // Add is greyed until there's something to add
    input.addTextChangedListener(object : android.text.TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
      override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
      override fun afterTextChanged(s: android.text.Editable?) { addState() }
    })
    // the small toolbar: a new line, [[ ]] (the cursor between them; around the words when some are selected),
    // # at the cursor, and the to-do word at the start of the note (TODO, or LATER as config.edn's
    // :preferred-workflow says; again: any to-do word taken off)
    fun put(text: String, back: Int = 0) {
      val s = maxOf(0, input.selectionStart); val e = maxOf(s, input.selectionEnd)
      input.text.replace(s, e, text)
      input.setSelection(s + text.length - back)
      input.requestFocus()
    }
    findViewById<Button>(R.id.qc_link).setOnClickListener {
      val s = maxOf(0, input.selectionStart); val e = maxOf(s, input.selectionEnd)
      if (e > s) { val w = input.text.substring(s, e); put("[[$w]]") } else put("[[]]", 2)
    }
    findViewById<Button>(R.id.qc_tag).setOnClickListener { put("#") }
    findViewById<ImageButton>(R.id.qc_newline).setOnClickListener { put("\n") } // (Shift+Enter's new line, on a phone)
    findViewById<ImageButton>(R.id.qc_todo).setOnClickListener {
      val at = maxOf(0, input.selectionStart)
      val (t, moved) = Checks.toggleTodo(input.text.toString(), todoWord)
      input.setText(t)
      input.setSelection((at + moved).coerceIn(0, input.text.length))
      input.requestFocus()
    }
    var picture: Uri? = null // a shared picture, until it's checked (away from the screen's thread)
    if (intent?.action == Intent.ACTION_SEND) {
      val type = intent.type ?: ""
      if (type.startsWith("image/")) {
        picture = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
      }
      // styled text arrives as a CharSequence, so read it that way (getStringExtra would give null)
      val subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString()?.trim().orEmpty()
      val body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim().orEmpty()
      // a shared web page (its title and address): one neat link, "[Title · site](address)"
      val (bodyWords, bodyUrl) = Journal.splitUrl(body)
      val shared = if (bodyUrl.isNotEmpty() && !bodyUrl.startsWith("[") && (bodyWords.isEmpty() || bodyWords == subject)) {
        Journal.mdLink(bodyUrl, subject.ifEmpty { bodyWords })
      } else listOf(subject, body).filter { it.isNotBlank() }.distinct().joinToString(" ")
      input.setText(shared)
      input.setSelection(input.text.length)
      val candidate = picture
      if (candidate != null) {
        // a picture: checked first (is it another app's? its provider is asked, off the screen's
        // thread); meanwhile neither the text box nor the keyboard shows. Then the picture (and its
        // name) instead of the text box, or, refused, the shared words as for a text share.
        input.visibility = View.GONE
        findViewById<View>(R.id.qc_tools).visibility = View.GONE
        Thread {
          val ok = sharedPicture(candidate)
          val name = if (ok) fileName(candidate) else ""
          runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            if (ok) {
              image = candidate
              findViewById<TextView>(R.id.qc_where).text = whereLine()
              findViewById<TextView>(R.id.qc_caption).apply { text = name; visibility = View.VISIBLE }
              showPreview(candidate)
            } else {
              input.visibility = View.VISIBLE
              findViewById<View>(R.id.qc_tools).visibility = View.VISIBLE
              input.requestFocus()
              window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
            }
            addState()
          }
        }.start()
      } else {
        // a web page: its passages already in the notes, under the words (he asked, Nov 12: "Can't I
        // just also see what is already highlighted?"); read only, off the screen's thread
        val address = webAddress(bodyUrl)
        if (address.isNotEmpty()) Thread {
          val k = try { LeanCore.kept(applicationContext, address) } catch (e: Throwable) { null }
          runOnUiThread { if (!isFinishing && k != null) showKept(k.first, k.second) }
        }.start()
      }
    }
    addState()
    if (picture == null) {
      input.requestFocus()
      window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
    } else window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN)
  }

  /** The web address in what was shared: a bare one, or the address of a "[words](address)" link. */
  private fun webAddress(u: String): String {
    val a = if (u.startsWith("[") && u.endsWith(")") && u.contains("](")) u.substring(u.lastIndexOf("](") + 2, u.length - 1) else u
    return if (a.startsWith("https://") || a.startsWith("http://")) a else ""
  }

  /** "2 highlights already in “Page”", then each passage with a bar in the accent; the first few
   *  only until it's tapped. */
  private fun showKept(page: String, passages: List<String>) {
    if (page.isEmpty() || passages.isEmpty()) return
    val v = findViewById<TextView>(R.id.qc_kept)
    val ink = Journal.color(this, "c_ink", 0xFF1D1A2E.toInt())
    val faint = Journal.color(this, "c_faint", 0xFF7A7383.toInt())
    val sb = android.text.SpannableStringBuilder()
    val n = passages.size
    sb.append(if (n == 1) "1 highlight already in “$page”" else "$n highlights already in “$page”")
    sb.setSpan(android.text.style.ForegroundColorSpan(faint), 0, sb.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    sb.setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, sb.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    for (p in passages) {
      sb.append("\n")
      val at = sb.length
      sb.append(p)
      sb.setSpan(android.text.style.QuoteSpan(accentColor), at, sb.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    v.text = sb
    v.setTextColor(ink)
    val dp = resources.displayMetrics.density
    v.background = GradientDrawable().apply { setColor(Journal.mix(Journal.color(this@QuickCaptureActivity, "c_bg", 0xFFFFFFFF.toInt()), ink, 0.05)); cornerRadius = 12 * dp }
    v.visibility = View.VISIBLE
    // a tap shows them all, again the first few
    v.setOnClickListener { v.maxLines = if (v.maxLines == 7) Int.MAX_VALUE else 7 }
  }

  /** The colours of the app's look: card, text, text box and buttons. */
  private fun paint() {
    val dp = resources.displayMetrics.density
    val bg = Journal.color(this, "c_bg", 0xFFFFFFFF.toInt())
    val ink = Journal.color(this, "c_ink", 0xFF1D1A2E.toInt())
    val faint = Journal.color(this, "c_faint", 0xFF7A7383.toInt())
    val accent = Journal.color(this, "c_accent", 0xFFC2331A.toInt())
    fun round(color: Int, radius: Float, stroke: Int = 0) = GradientDrawable().apply {
      setColor(color); cornerRadius = radius * dp
      if (stroke != 0) setStroke((1 * dp).toInt(), stroke)
    }
    val card = findViewById<View>(R.id.qc_card)
    card.background = round(bg, 20f)
    // not wider than a phone on a tablet
    val maxW = (480 * dp).toInt()
    if (resources.displayMetrics.widthPixels > maxW + (24 * dp).toInt()) card.layoutParams = card.layoutParams.apply { width = maxW }
    // the tool chips: each its own soft fill and a visible edge, so it's clear where one ends and the
    // next begins (he asked: in Build 38 they ran together)
    for (id in listOf(R.id.qc_link, R.id.qc_tag, R.id.qc_todo, R.id.qc_newline, R.id.qc_paste)) {
      val v = findViewById<View>(id)
      v.background = round(Journal.mix(bg, ink, 0.06), 10f, Journal.mix(bg, ink, 0.16))
      v.backgroundTintList = null
      if (v is ImageButton) v.imageTintList = android.content.res.ColorStateList.valueOf(ink)
      else if (v is Button) v.setTextColor(ink)
    }
    accentColor = accent; idle = Journal.mix(bg, ink, 0.1); idleInk = Journal.mix(bg, ink, 0.4)
    findViewById<TextView>(R.id.qc_where).setTextColor(faint)
    findViewById<TextView>(R.id.qc_caption).setTextColor(faint)
    findViewById<TextView>(R.id.qc_error).setTextColor(Journal.mix(0xFFD32F2F.toInt(), ink, 0.25))
    findViewById<EditText>(R.id.qc_input).apply {
      background = null // the card is the box
      setTextColor(ink)
      setHintTextColor(faint)
    }
    findViewById<ImageView>(R.id.qc_image).apply {
      background = round(Journal.mix(bg, ink, 0.055), 16f)
      clipToOutline = true // rounded corners for the picture too
    }
  }

  private var accentColor = 0
  private var idle = 0
  private var idleInk = 0

  /** "Add to <page>" (or "Add a picture to <page>") for the small line at the top. */
  private fun whereLine() = (if (image != null) "Add a picture to " else "Add to ") + where

  /** The round Add: the accent when there's something to add (and nothing is being added), else greyed.
   *  A tap outside the card closes the pop-up only while there's nothing in it to lose. */
  private fun addState() {
    val b = findViewById<ImageButton>(R.id.qc_add)
    val something = image != null || findViewById<EditText>(R.id.qc_input).text.isNotBlank()
    setFinishOnTouchOutside(!something && !busy)
    val on = !busy && something
    b.isEnabled = on
    b.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (on) accentColor else idle) }
    b.backgroundTintList = null
    b.imageTintList = android.content.res.ColorStateList.valueOf(if (on) Journal.onColor(accentColor) else idleInk)
  }

  /** A small copy of the shared picture, made away from the screen's thread and turned the way
   *  the camera meant (photos often say so in their EXIF data rather than in the pixels). */
  private fun showPreview(uri: Uri) {
    val view = findViewById<ImageView>(R.id.qc_image)
    Thread {
      val bmp: Bitmap? = try {
        // read once (a picture shared from the cloud may be fetched again each time), at most
        // PREVIEW_MAX bytes whatever size the other app says (the review's claim 15b); a bigger one
        // gets no preview
        val bytes = contentResolver.openInputStream(uri)?.use { Checks.readAtMost(it, PREVIEW_MAX) } ?: throw java.io.IOException("too big for a preview")
        val open = { ByteArrayInputStream(bytes) }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open().use { BitmapFactory.decodeStream(it, null, bounds) }
        val w = bounds.outWidth.toLong()
        val h = bounds.outHeight.toLong()
        // a preview-sized copy: under about 1800 pixels across and 4 million pixels in all (a long
        // screenshot at full size would be too big to draw)
        var sample = 1
        while (w > 0 && h > 0 && (w / (sample * 2) >= 900 || (w / sample) * (h / sample) > 4_000_000L)) sample *= 2
        val raw = if (w <= 0 || h <= 0) null else open().use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
        val turn = try {
          open().use {
            when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
              ExifInterface.ORIENTATION_ROTATE_90 -> 90f
              ExifInterface.ORIENTATION_ROTATE_180 -> 180f
              ExifInterface.ORIENTATION_ROTATE_270 -> 270f
              else -> 0f
            }
          }
        } catch (e: Exception) { 0f }
        if (raw != null && turn != 0f) Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(turn) }, true) else raw
      } catch (e: Exception) { null } catch (e: OutOfMemoryError) { null }
      runOnUiThread { if (bmp != null && !isFinishing) { view.setImageBitmap(bmp); view.visibility = View.VISIBLE } }
    }.start()
  }

  // Only a picture another app hands over (content://, from a provider that isn't this app's own,
  // of an image type): the pop-up opens it with this app's rights, so a file:// address or one of
  // this app's own files (its notes' index, its settings) must never be copied into the notes.
  // Asks other apps (their providers): never on the screen's thread.
  private fun sharedPicture(uri: Uri): Boolean {
    return try {
      if (uri.scheme != "content") return false
      // (the raw authority: any "@" in it is refused, as Android reads the provider after the last
      // one, so "a@0@<this app's provider>" would be this app's own: the review's claim 15a)
      val authority = uri.authority ?: return false
      if (!Checks.otherAppsAuthority(authority, packageName) || !Checks.otherAppsAuthority(uri.encodedAuthority, packageName)) return false
      // (another app's provider may be hidden from this one, so unknown is allowed; this app's own
      // always shows, and its authorities start with the package name)
      val owner = packageManager.resolveContentProvider(authority, 0)?.packageName
      if (owner == packageName) return false
      val type = contentResolver.getType(uri)
      type == null || type.startsWith("image/")
    } catch (e: Exception) { false }
  }

  private fun fileName(uri: Uri): String {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) return c.getString(0) ?: "image.png"
      }
    } catch (e: Exception) { }
    return uri.lastPathSegment ?: "image.png"
  }

  /** Adds the note (or picture) away from the screen's thread, so a big picture never freezes
   *  the pop-up. On failure the pop-up stays open with the reason, so nothing is lost. */
  private fun add(text: String) {
    if (busy) return
    val img = image
    if (img == null && text.isBlank()) { finish(); return }
    if (!adding.compareAndSet(false, true)) {
      Toast.makeText(this, "A note is still being added. Try again in a moment.", Toast.LENGTH_SHORT).show()
      return
    }
    busy = true
    addState()
    findViewById<TextView>(R.id.qc_error).visibility = View.GONE
    Thread {
      val result: Result<String> = try {
        Result.success(if (img != null) LeanCore.addPicture(this, img, fileName(img), savedLink) else LeanCore.addText(this, text.trim()))
      } catch (e: Throwable) {
        if (e is LeanCore.Failed && e.link != null) savedLink = e.link
        Result.failure(e)
      } finally {
        adding.set(false)
      }
      if (result.isSuccess) try { Journal.refresh(this) } catch (e: Exception) { } // the widget shows it
      runOnUiThread {
        busy = false
        addState()
        result.fold(
          onSuccess = {
            Toast.makeText(this, "Added to $where", Toast.LENGTH_SHORT).show()
            finish()
          },
          onFailure = { e ->
            val why = e.message ?: "Couldn't add it, so nothing was added."
            showError(why)
            Toast.makeText(this, why, Toast.LENGTH_LONG).show()
          },
        )
      }
    }.start()
  }

  /** The reason something couldn't be added, in the card under the text (which stays). */
  private fun showError(why: String) {
    findViewById<TextView>(R.id.qc_error).apply { text = why; visibility = View.VISIBLE }
  }
}
