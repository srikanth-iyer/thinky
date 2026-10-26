// Small pop-up for adding a note: opened by the widgets' + buttons, or by sharing text or a
// picture from another app ("Add to journal" in the share menu). Uses Logseq's quick capture
// format from config.edn. With "add shared things straight away" on, shares skip the pop-up
// (and the pop-up appears after all if that fails, with the reason).
// Looks like the app: a rounded card near the bottom of the screen in the colours of the look the
// app last used (sent with setWidgetColors), a soft text box, pill-shaped buttons, and a preview
// of a shared picture.
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
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.io.ByteArrayInputStream

class QuickCaptureActivity : AppCompatActivity() {
  private var image: Uri? = null
  private var busy = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    supportRequestWindowFeature(android.view.Window.FEATURE_NO_TITLE) // our own heading says where it goes
    setContentView(R.layout.activity_quick_capture)
    setFinishOnTouchOutside(true)
    // a card near the bottom, full width with a margin (less wide on tablets), softly dimmed behind
    window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    window.setGravity(Gravity.BOTTOM)
    window.setDimAmount(0.3f)
    paint()
    val input = findViewById<EditText>(R.id.qc_input)
    val where = try { Journal.captureTarget(this)?.second } catch (e: Exception) { null } ?: Journal.todayTitle(this)
    findViewById<TextView>(R.id.qc_where).text = "to $where"
    // buttons first, so the pop-up always works (also when a one-tap share fails below)
    findViewById<Button>(R.id.qc_paste).setOnClickListener {
      val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
      val clip = cm.primaryClip
      val t = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this)?.toString() else null
      if (!t.isNullOrEmpty()) input.text.insert(maxOf(0, input.selectionStart), t)
    }
    findViewById<Button>(R.id.qc_add).setOnClickListener { add(input.text.toString()) }
    if (intent?.action == Intent.ACTION_SEND) {
      val type = intent.type ?: ""
      if (type.startsWith("image/")) {
        image = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
      }
      // styled text arrives as a CharSequence, so read it that way (getStringExtra would give null)
      val shared = listOfNotNull(intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString(), intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString())
        .filter { it.isNotBlank() }.distinct().joinToString(" ")
      val img = image
      if (img != null) {
        // a picture: show it (and its name) instead of the text box
        findViewById<TextView>(R.id.qc_title).text = "Add a picture"
        input.visibility = View.GONE
        findViewById<View>(R.id.qc_paste).visibility = View.GONE
        findViewById<TextView>(R.id.qc_caption).apply { text = fileName(img); visibility = View.VISIBLE }
        showPreview(img)
      } else {
        input.setText(shared)
        input.setSelection(input.text.length)
      }
      if (Journal.oneTap(this) && (img != null || shared.isNotBlank())) { add(input.text.toString()); return }
    }
    if (image == null) {
      input.requestFocus()
      window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
    }
  }

  /** The colours of the app's look: card, text, text box and buttons. */
  private fun paint() {
    val dp = resources.displayMetrics.density
    val bg = Journal.color(this, "c_bg", 0xFFFFFFFF.toInt())
    val ink = Journal.color(this, "c_ink", 0xFF1A2130.toInt())
    val faint = Journal.color(this, "c_faint", 0xFF8A93A2.toInt())
    val accent = Journal.color(this, "c_accent", 0xFF0B7B66.toInt())
    fun round(color: Int, radius: Float, stroke: Int = 0) = GradientDrawable().apply {
      setColor(color); cornerRadius = radius * dp
      if (stroke != 0) setStroke((1 * dp).toInt(), stroke)
    }
    val card = findViewById<View>(R.id.qc_card)
    card.background = round(bg, 26f)
    // not wider than a phone on a tablet
    val maxW = (480 * dp).toInt()
    if (resources.displayMetrics.widthPixels > maxW + (24 * dp).toInt()) card.layoutParams = card.layoutParams.apply { width = maxW }
    findViewById<TextView>(R.id.qc_badge).apply {
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Journal.mix(bg, accent, 0.16)) }
      setTextColor(accent)
    }
    findViewById<TextView>(R.id.qc_title).setTextColor(ink)
    findViewById<TextView>(R.id.qc_where).setTextColor(faint)
    findViewById<TextView>(R.id.qc_caption).setTextColor(faint)
    findViewById<EditText>(R.id.qc_input).apply {
      background = round(Journal.mix(bg, ink, 0.055), 16f)
      setTextColor(ink)
      setHintTextColor(faint)
    }
    findViewById<ImageView>(R.id.qc_image).apply {
      background = round(Journal.mix(bg, ink, 0.055), 16f)
      clipToOutline = true // rounded corners for the picture too
    }
    findViewById<Button>(R.id.qc_paste).apply {
      background = round(Color.TRANSPARENT, 999f, Journal.mix(bg, ink, 0.2))
      backgroundTintList = null
      setTextColor(ink)
    }
    findViewById<Button>(R.id.qc_add).apply {
      background = round(accent, 999f)
      backgroundTintList = null
      setTextColor(Journal.onColor(accent))
    }
  }

  /** A small copy of the shared picture, made away from the screen's thread and turned the way
   *  the camera meant (photos often say so in their EXIF data rather than in the pixels). */
  private fun showPreview(uri: Uri) {
    val view = findViewById<ImageView>(R.id.qc_image)
    Thread {
      val bmp: Bitmap? = try {
        // read once when it isn't huge: a picture shared from the cloud may be fetched again each time
        val size = sizeOf(uri)
        val bytes = if (size in 1..40_000_000L) contentResolver.openInputStream(uri)?.use { it.readBytes() } else null
        val open = { if (bytes != null) ByteArrayInputStream(bytes) else contentResolver.openInputStream(uri) }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open()?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val w = bounds.outWidth.toLong()
        val h = bounds.outHeight.toLong()
        // a preview-sized copy: under about 1800 pixels across and 4 million pixels in all (a long
        // screenshot at full size would be too big to draw)
        var sample = 1
        while (w > 0 && h > 0 && (w / (sample * 2) >= 900 || (w / sample) * (h / sample) > 4_000_000L)) sample *= 2
        val raw = if (w <= 0 || h <= 0) null else open()?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
        val turn = try {
          open()?.use {
            when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
              ExifInterface.ORIENTATION_ROTATE_90 -> 90f
              ExifInterface.ORIENTATION_ROTATE_180 -> 180f
              ExifInterface.ORIENTATION_ROTATE_270 -> 270f
              else -> 0f
            }
          } ?: 0f
        } catch (e: Exception) { 0f }
        if (raw != null && turn != 0f) Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(turn) }, true) else raw
      } catch (e: Exception) { null } catch (e: OutOfMemoryError) { null }
      runOnUiThread { if (bmp != null && !isFinishing) { view.setImageBitmap(bmp); view.visibility = View.VISIBLE } }
    }.start()
  }

  /** The shared file's size in bytes, or -1 if the app sharing it doesn't say. */
  private fun sizeOf(uri: Uri): Long {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) return c.getLong(0)
      }
    } catch (e: Exception) { }
    return -1
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
    busy = true
    val addButton = findViewById<Button>(R.id.qc_add)
    addButton.isEnabled = false
    addButton.alpha = 0.6f
    Thread {
      val result: Result<String> = runCatching {
        if (img != null) {
          val name = fileName(img)
          val link = Journal.saveAsset(this, img, name)
          Journal.captureMedia(this, "![${name.substringBeforeLast('.')}]($link)")
        } else Journal.captureText(this, text.trim())
      }
      runOnUiThread {
        busy = false
        addButton.isEnabled = true
        addButton.alpha = 1f
        result.fold(
          onSuccess = { went ->
            Toast.makeText(this, "Added to $went", Toast.LENGTH_SHORT).show()
            finish()
          },
          onFailure = { e -> Toast.makeText(this, e.message ?: "Couldn't add it", Toast.LENGTH_LONG).show() },
        )
      }
    }.start()
  }
}
