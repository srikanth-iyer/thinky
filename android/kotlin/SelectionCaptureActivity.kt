// "Add to thinky" in the menu that appears over selected text in other apps (Android's
// PROCESS_TEXT; Build 37, he asked Nov 6): the selected words go straight to where quick captures go
// (today's journal), with no window, and a short message says so. Many passages from one article
// can be added one after another without anything getting in the way.
// They always go to the usual place, never to an article's own page: Android gives only the words,
// not the page's address, so the app couldn't tell which article they came from (he chose this).
// The words are kept as plain words and plain lines ("plain": outline_core::clip::defuse and guard),
// as with the Edge extension's highlights: a page's text can't become a link, tag, property, to-do,
// new note or code block in the notes.
// He starts it himself (it's in the text menu only), so no page can add notes by itself; the share
// pop-up still always asks (Build 34). Another app could still start this screen directly (Android
// has to let other apps reach the text menu's entries), so (the outside review's claim 11a) only a
// PROCESS_TEXT request counts, at most Checks.SELECTED_MAX characters, and at most
// Checks.SELECTED_PER_WINDOW a minute: far more than a person adds by hand.
// The invisible screen stays until the words are written (claim 11c: closed at once, Android could
// stop the app before the helper thread wrote them), then closes.
// The package line is added by scripts/android_overlay.py.

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast

class SelectionCaptureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // (started again by Android after it stopped the app: the words were already handled then)
    if (savedInstanceState != null) { finish(); return }
    val asked = Build.VERSION.SDK_INT >= 23 && intent?.action == Intent.ACTION_PROCESS_TEXT
    val text = (if (asked) intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT) else null)?.toString()?.trim().orEmpty()
    val refused = when {
      text.isEmpty() -> "Nothing was selected, so nothing was added."
      text.length > Checks.SELECTED_MAX -> "That's more than ${Checks.SELECTED_MAX} characters, so nothing was added. Select less."
      !allowedNow(this) -> "Many selections were added in the last minute, so this one wasn't. Try again in a minute."
      else -> null
    }
    if (refused != null) {
      Toast.makeText(this, refused, Toast.LENGTH_SHORT).show()
      finish()
      return
    }
    val ctx = applicationContext
    // the words are added on a helper thread (the first time loads the app's library); this
    // invisible screen closes once they are written, so the reading app stays in front
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
      runOnUiThread {
        Toast.makeText(ctx, said, Toast.LENGTH_SHORT).show()
        finish()
      }
      try { Journal.refresh(ctx) } catch (e: Throwable) { /* the widget catches up next time */ }
    }.start()
  }

  companion object {
    /** Counts this selection if fewer than Checks.SELECTED_PER_WINDOW were added in the last minute
     *  (kept in the app's settings, so a new process counts the same). */
    @Synchronized fun allowedNow(ctx: Context): Boolean {
      val prefs = Journal.prefs(ctx)
      val now = System.currentTimeMillis()
      val recent = Checks.recentTimes(prefs.getString("selected_times", null), now)
      if (!Checks.selectionAllowed(recent)) return false
      prefs.edit().putString("selected_times", (recent + now).joinToString(",")).apply()
      return true
    }
  }
}
