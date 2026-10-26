// Quick Settings tile "Add note" (pull down from the top of the screen, then edit the tiles to add
// it): a tap opens the same "Add a note" pop-up as the home-screen widget's + and closes the shade.
// On a locked phone it asks to unlock first, since the pop-up writes to the notes.
// The package line is added by scripts/android_overlay.py.

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class AddNoteTile : TileService() {
  override fun onStartListening() {
    val tile = qsTile ?: return
    tile.state = Tile.STATE_INACTIVE // a button, not an on/off switch
    tile.updateTile()
  }

  override fun onClick() {
    if (isLocked) unlockAndRun { showPopup() } else showPopup()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun showPopup() {
    val add = Intent(this, QuickCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      // Android 14 and later only take a PendingIntent here
      startActivityAndCollapse(PendingIntent.getActivity(this, 4, add, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    } else {
      @Suppress("DEPRECATION") startActivityAndCollapse(add)
    }
  }
}
