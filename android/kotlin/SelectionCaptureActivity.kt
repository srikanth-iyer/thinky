// "Add to thinky" in the menu that appears over selected text in other apps (Android's
// PROCESS_TEXT; Build 37, he asked Nov 6): the selected words go straight to where quick captures go
// (today's journal), with no window, and a short message says so. Many passages from one article
// can be added one after another without anything getting in the way.
// They always go to the usual place, never to an article's own page: Android gives only the words,
// not the page's address, so the app couldn't tell which article they came from (he chose this).
// The words are kept as plain words ("plain": outline_core::clip::defuse), as with the Edge
// extension's highlights: a page's text can't become a link, tag, property or to-do in the notes.
// He starts it himself (it's in the text menu only), so no page can add notes by itself; the share
// pop-up still always asks (Build 34).
// The package line is added by scripts/android_overlay.py.

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast

class SelectionCaptureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = (if (Build.VERSION.SDK_INT >= 23) intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT) else null)?.toString()?.trim().orEmpty()
    if (text.isEmpty()) {
      Toast.makeText(this, "Nothing was selected, so nothing was added.", Toast.LENGTH_SHORT).show()
      finish()
      return
    }
    val ctx = applicationContext
    // the words are added on a helper thread (the first time loads the app's library); this
    // invisible screen closes at once, so the reading app stays in front
    Thread {
      val said = try {
        LeanCore.addSelected(ctx, text)
        val where = try { Journal.captureWhere(ctx) } catch (e: Exception) { "today's journal" }
        "Added to $where"
      } catch (e: LeanCore.Failed) {
        e.message ?: "Couldn't add it."
      } catch (e: Throwable) {
        "Couldn't add it (${e.message ?: e.javaClass.simpleName})."
      }
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        Toast.makeText(ctx, said, Toast.LENGTH_SHORT).show()
      }
      try { Journal.refresh(ctx) } catch (e: Throwable) { /* the widget catches up next time */ }
    }.start()
    finish()
  }
}
