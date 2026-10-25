// Small pop-up for adding a note to today's journal: opened by the widget's + button,
// or by sharing text from another app ("Add to journal" in the share sheet).
// The package line is added by scripts/android_overlay.py.

import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class QuickCaptureActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    supportRequestWindowFeature(android.view.Window.FEATURE_NO_TITLE) // our own heading says where it goes
    setContentView(R.layout.activity_quick_capture)
    setFinishOnTouchOutside(true)
    val input = findViewById<EditText>(R.id.qc_input)
    findViewById<TextView>(R.id.qc_title).text = "Add to " + Journal.todayTitle(this)
    if (intent?.action == Intent.ACTION_SEND) {
      val shared = listOfNotNull(intent.getStringExtra(Intent.EXTRA_SUBJECT), intent.getStringExtra(Intent.EXTRA_TEXT))
        .filter { it.isNotBlank() }.distinct().joinToString(" — ")
      input.setText(shared)
      input.setSelection(input.text.length)
    }
    findViewById<Button>(R.id.qc_paste).setOnClickListener {
      val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
      val clip = cm.primaryClip
      val t = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this)?.toString() else null
      if (!t.isNullOrEmpty()) input.text.insert(maxOf(0, input.selectionStart), t)
    }
    findViewById<Button>(R.id.qc_add).setOnClickListener {
      val text = input.text.toString().trim()
      if (text.isEmpty()) { finish(); return@setOnClickListener }
      val ok = try { Journal.append(this, text) } catch (e: Exception) { false }
      Toast.makeText(this, if (ok) "Added to today's journal" else "Open Lean Outliner once and choose your notes folder first", Toast.LENGTH_LONG).show()
      if (ok) finish()
    }
    input.requestFocus()
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
  }
}
