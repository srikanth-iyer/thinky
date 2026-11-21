// Tests for android/kotlin/Checks.kt on a plain JVM (no phone, no Android SDK): android/test/run.sh.
// Not copied into the app (android_overlay.py copies android/kotlin/*.kt only).

var failed = 0
var passed = 0

fun check(what: String, ok: Boolean) {
  if (ok) passed++ else { failed++; println("FAIL $what") }
}

fun <T> eq(what: String, got: T, want: T) = check("$what: got $got, want $want", got == want)

fun aiKeys() {
  // the fixed bases are the core's (core/src/ai.rs PROVIDERS): a request the core builds may carry the key
  eq("claude's messages", Checks.keyMayGo("claude", "https://api.anthropic.com/v1/messages", null), true)
  eq("claude's models", Checks.keyMayGo("claude", "https://api.anthropic.com/v1/models", null), true)
  eq("openai", Checks.keyMayGo("openai", "https://api.openai.com/v1/chat/completions", null), true)
  eq("gemini", Checks.keyMayGo("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", null), true)
  eq("openrouter", Checks.keyMayGo("openrouter", "https://openrouter.ai/api/v1/models", null), true)
  // the review's attack: the page asks for the Claude key to go somewhere else
  eq("claude key to another computer", Checks.keyMayGo("claude", "https://attacker.example/v1/messages", null), false)
  eq("claude key to a look-alike name", Checks.keyMayGo("claude", "https://api.anthropic.com.attacker.example/v1/messages", null), false)
  eq("claude key with a name before @", Checks.keyMayGo("claude", "https://api.anthropic.com@attacker.example/v1/messages", null), false)
  eq("claude key to its base without the /", Checks.keyMayGo("claude", "https://api.anthropic.com/v1", null), false)
  eq("claude key to a longer path name", Checks.keyMayGo("claude", "https://api.anthropic.com/v10/messages", null), false)
  eq("claude key over http", Checks.keyMayGo("claude", "http://api.anthropic.com/v1/messages", null), false)
  eq("capitals are not the base", Checks.keyMayGo("claude", "https://API.anthropic.com/v1/messages", null), false)
  eq("openai key to claude", Checks.keyMayGo("openai", "https://api.anthropic.com/v1/messages", null), false)
  eq("a space in the address", Checks.keyMayGo("openai", "https://api.openai.com/v1/chat completions", null), false)
  eq("a line break in the address", Checks.keyMayGo("openai", "https://api.openai.com/v1/x\r\nHost: evil", null), false)
  eq("a given other base doesn't widen claude", Checks.keyMayGo("claude", "https://attacker.example/v1/messages", "https://attacker.example/v1"), false)
  // programs on a computer and unknown services: no key ever
  eq("ollama", Checks.keyMayGo("ollama", "http://localhost:11434/v1/chat/completions", null), false)
  eq("lmstudio", Checks.keyMayGo("lmstudio", "http://localhost:1234/v1/models", null), false)
  eq("unknown service", Checks.keyMayGo("mystery", "https://api.openai.com/v1/models", null), false)
  eq("empty service", Checks.keyMayGo("", "https://api.openai.com/v1/models", null), false)
  // "Other": only to the address saved with its key
  eq("other to its own address", Checks.keyMayGo("other", "https://ai.example.org/v1/chat/completions", "https://ai.example.org/v1"), true)
  eq("other, saved with a final /", Checks.keyMayGo("other", "https://ai.example.org/v1/models", "https://ai.example.org/v1/"), true)
  eq("other with a port", Checks.keyMayGo("other", "https://ai.example.org:8443/v1/models", "https://ai.example.org:8443/v1"), true)
  eq("other with no address saved", Checks.keyMayGo("other", "https://ai.example.org/v1/models", null), false)
  eq("other with an empty address saved", Checks.keyMayGo("other", "https://ai.example.org/v1/models", ""), false)
  eq("other to another computer", Checks.keyMayGo("other", "https://attacker.example/v1/models", "https://ai.example.org/v1"), false)
  eq("other to a longer name", Checks.keyMayGo("other", "https://ai.example.org.attacker.example/v1/models", "https://ai.example.org"), false)
  eq("other saved with an @", Checks.keyMayGo("other", "https://localhost@attacker.example/v1/models", "https://localhost@attacker.example/v1"), false)
  eq("other saved as http", Checks.keyMayGo("other", "http://192.168.1.5/v1/models", "http://192.168.1.5/v1"), false)

  eq("key header claude", Checks.keyHeader("claude"), "x-api-key")
  for (s in listOf("openai", "gemini", "openrouter", "other")) eq("key header $s", Checks.keyHeader(s), "bearer")
  for (s in listOf("ollama", "lmstudio", "", "x-api-key", "CLAUDE")) eq("no key header for '$s'", Checks.keyHeader(s), null)

  // check_base, as the phone keeps it
  eq("plain https", Checks.checkBase(" https://ai.example.org/v1/ "), "https://ai.example.org/v1")
  eq("just the computer", Checks.checkBase("https://ai.example.org"), "https://ai.example.org")
  eq("IPv6", Checks.checkBase("https://[2001:db8::1]:8443/v1"), "https://[2001:db8::1]:8443/v1")
  for (bad in listOf("", "   ", "http://ai.example.org/v1", "ftp://ai.example.org", "ai.example.org/v1",
      "https://", "https:///v1", "https://user@ai.example.org/v1", "https://localhost:80@attacker.example/v1",
      "https://[::1]@attacker.example/v1", "https://ai.example.org/v1@x", "https://{a,b}.example.org/v1",
      "https://ai.example.org/{x}", "https://ai.example.org?x=1", "https://ai.example.org#frag",
      "https://ai.example.org/v1?x=1/", "https://ai example.org", "https://ai.example.org/\"x", "https://ai.example.org\\x",
      "https://ai.example.org:/v1", "https://ai.example.org:12x/v1", "https://ai.example.org:123456/v1",
      "https://[::1/v1", "https://[]/v1", "https://[::1]x/v1", "https://.example.org", "https://a..b",
      "https://exämple.org", "https://ai.example.org\n/v1", "https://ai.example.org/v1'")) {
    eq("refused base '$bad'", Checks.checkBase(bad), null)
  }
}

fun thumbs() {
  // the box: 160 x 72 dp, kept under THUMB_PIXELS
  eq("box at mdpi", Checks.thumbBox(1f), 160 to 72)
  eq("box at xhdpi", Checks.thumbBox(2f), 320 to 144)
  val (w4, h4) = Checks.thumbBox(4f)
  check("box at xxxhdpi under the cap: $w4 x $h4", w4.toLong() * h4 <= Checks.THUMB_PIXELS && w4 > 400 && h4 > 180)
  check("box keeps its shape: $w4 x $h4", Math.abs(w4.toDouble() / h4 - 160.0 / 72) < 0.02)
  eq("box at density 0", Checks.thumbBox(0f), 1 to 1)
  // the review's case: 400 x 12000 was read whole (sample 1, 19 MB); now small in both directions
  val s = Checks.sampleSize(400, 12000, 640, 288)
  check("tall screenshot sampled: $s", s >= 16 && 12000 / s < 2 * 288 && 400 / s < 2 * 640)
  eq("wide panorama", Checks.sampleSize(20000, 300, 640, 288), 16)
  eq("small picture read as it is", Checks.sampleSize(48, 24, 320, 144), 1)
  eq("just under twice the box", Checks.sampleSize(639, 287, 320, 144), 1)
  eq("twice the box", Checks.sampleSize(640, 288, 320, 144), 2)
  eq("a camera photo (250 x 187 read)", Checks.sampleSize(4000, 3000, 320, 144), 16)
  eq("nothing known", Checks.sampleSize(0, 100, 320, 144), 1)
  eq("no box", Checks.sampleSize(100, 100, 0, 0), 1)
  check("huge sizes stop", Checks.sampleSize(Int.MAX_VALUE, Int.MAX_VALUE, 1, 1) <= (1 shl 16))
  // whatever is read, the copy drawn is never bigger than the box
  for ((w, h) in listOf(400 to 12000, 20000 to 300, 48 to 24, 4000 to 3000, 1 to 1, 640 to 288)) {
    val (bw, bh) = Checks.thumbBox(3.5f)
    val k = Checks.sampleSize(w, h, bw, bh)
    val (fw, fh) = Checks.fitIn(maxOf(1, w / k), maxOf(1, h / k), bw, bh)
    check("$w x $h fits the box: $fw x $fh in $bw x $bh", fw in 1..bw && fh in 1..bh)
    check("$w x $h read at most 4x the box's pixels", (w / k).toLong() * (h / k) <= 4L * bw * bh)
  }
  eq("fit: never bigger", Checks.fitIn(10, 10, 100, 100), 10 to 10)
  eq("fit: wide", Checks.fitIn(1000, 100, 100, 100), 100 to 10)
  eq("fit: nothing", Checks.fitIn(0, 10, 100, 100), 0 to 0)
  eq("jpeg is opaque", Checks.opaqueType("image/jpeg"), true)
  eq("png may be see-through", Checks.opaqueType("image/png"), false)
  eq("unknown type", Checks.opaqueType(null), false)
}

fun sharing() {
  val pkg = "com.srikanth.leanoutliner"
  eq("another app's provider", Checks.otherAppsAuthority("media", pkg), true)
  eq("a gallery's provider", Checks.otherAppsAuthority("com.google.android.apps.photos.contentprovider", pkg), true)
  eq("this app's file provider", Checks.otherAppsAuthority("$pkg.fileprovider", pkg), false)
  eq("this app's, in capitals", Checks.otherAppsAuthority("COM.SRIKANTH.LEANOUTLINER.fileprovider", pkg), false)
  // the review's case: content://a@0@<this app>.fileprovider/… (Android reads the provider after the last @)
  eq("hidden behind @s", Checks.otherAppsAuthority("a@0@$pkg.fileprovider", pkg), false)
  eq("one @", Checks.otherAppsAuthority("0@$pkg.fileprovider", pkg), false)
  eq("@ before another app's", Checks.otherAppsAuthority("user@media", pkg), false)
  eq("none", Checks.otherAppsAuthority(null, pkg), false)
  eq("empty", Checks.otherAppsAuthority("", pkg), false)
  eq("with a slash", Checks.otherAppsAuthority("media/x", pkg), false)

  val small = ByteArray(1000) { it.toByte() }
  check("read under the limit", Checks.readAtMost(java.io.ByteArrayInputStream(small), 1000)?.contentEquals(small) == true)
  eq("over the limit by one", Checks.readAtMost(java.io.ByteArrayInputStream(ByteArray(1001)), 1000), null)
  eq("empty", Checks.readAtMost(java.io.ByteArrayInputStream(ByteArray(0)), 10)?.size, 0)
  // a stream that never ends (an app that keeps sending): only max + 1 bytes are read
  var read = 0L
  val endless = object : java.io.InputStream() {
    override fun read(): Int { read++; return 1 }
    override fun read(b: ByteArray, off: Int, len: Int): Int { read += len; return len }
  }
  eq("an endless stream is refused", Checks.readAtMost(endless, 5_000_000), null)
  check("and read no further than the limit: $read", read <= 5_000_001)
  val big = ByteArray(300_000) { (it % 7).toByte() }
  check("several chunks", Checks.readAtMost(java.io.ByteArrayInputStream(big), 300_000)?.contentEquals(big) == true)
}

fun selection() {
  val now = 1_000_000_000L
  eq("nothing kept", Checks.recentTimes(null, now), emptyList<Long>())
  eq("garbage kept", Checks.recentTimes("x,,12a", now), emptyList<Long>())
  eq("old ones dropped", Checks.recentTimes("${now - 60_000},${now - 59_999},${now - 1}", now), listOf(now - 59_999, now - 1))
  eq("future ones (clock set back) dropped", Checks.recentTimes("${now + 5000}", now), emptyList<Long>())
  check("a person adding passages", Checks.selectionAllowed(List(9) { now - it * 5000L }))
  check("an app that keeps asking", !Checks.selectionAllowed(List(10) { now - it * 100L }))
  check("allowed again a minute later", Checks.selectionAllowed(Checks.recentTimes(List(10) { now - it * 100L }.joinToString(","), now + 61_000)))
  check("the length cap is the core's", Checks.SELECTED_MAX == 20_000)
}

fun todo() {
  eq("todo added", Checks.toggleTodo("buy milk", "TODO"), "TODO buy milk" to 5)
  eq("later with the now workflow", Checks.toggleTodo("buy milk", "LATER"), "LATER buy milk" to 6)
  eq("taken off", Checks.toggleTodo("TODO buy milk", "TODO"), "buy milk" to -5)
  eq("LATER taken off with the todo workflow", Checks.toggleTodo("LATER buy milk", "TODO"), "buy milk" to -6)
  eq("DONE taken off", Checks.toggleTodo("DONE x", "LATER"), "x" to -5)
  eq("WAITING is not WAIT", Checks.markerAt("WAITING for"), "WAITING ")
  eq("a word that only starts like one", Checks.toggleTodo("TODOS list", "TODO"), "TODO TODOS list" to 5)
  eq("empty marker", Checks.toggleTodo("x", " "), "TODO x" to 5)
  eq("empty note", Checks.toggleTodo("", "TODO"), "TODO " to 5)
}

fun signatures() {
  // the updater's pre-check fails closed (claim 12): nothing known is never "signed like this app"
  eq("same one", Checks.allAmong(listOf("A"), listOf("A")), true)
  eq("ours among theirs (older ones listed too)", Checks.allAmong(listOf("B"), listOf("A", "B")), true)
  eq("another key", Checks.allAmong(listOf("A"), listOf("B")), false)
  eq("not all of ours", Checks.allAmong(listOf("A", "B"), listOf("A")), false)
  eq("theirs unknown", Checks.allAmong(listOf("A"), null), false)
  eq("ours unknown", Checks.allAmong(null, listOf("A")), false)
  eq("ours empty", Checks.allAmong(emptyList(), listOf("A")), false)
  eq("theirs empty", Checks.allAmong(listOf("A"), emptyList()), false)
  eq("both unknown", Checks.allAmong<String>(null, null), false)
}

fun frontMatter() {
  val notes = "- first note\n- second"
  eq("front matter left out", Checks.withoutFrontMatter("---\ntitle: Day\ntags: [a, b]\n---\n$notes"), notes)
  eq("with Windows line ends", Checks.withoutFrontMatter("---\r\ntitle: Day\r\n---\r\n- a\r\n"), "- a\r\n")
  eq("ended by ...", Checks.withoutFrontMatter("---\ntitle: Day\n...\n$notes"), notes)
  eq("comments, blanks and lists after a key", Checks.withoutFrontMatter("---\n# c\n\ntags:\n  - a\n- b\n---\n$notes"), notes)
  eq("no key: not front matter", Checks.withoutFrontMatter("---\n---\n$notes"), "---\n---\n$notes")
  eq("a Logseq property isn't YAML", Checks.withoutFrontMatter("---\ntitle:: Day\n---\n$notes"), "---\ntitle:: Day\n---\n$notes")
  eq("a bullet before any key", Checks.withoutFrontMatter("---\n- a\n---\n"), "---\n- a\n---\n")
  eq("never closed", Checks.withoutFrontMatter("---\ntitle: Day\n$notes"), "---\ntitle: Day\n$notes")
  eq("not at the start", Checks.withoutFrontMatter("- a\n---\ntitle: x\n---"), "- a\n---\ntitle: x\n---")
  eq("plain notes", Checks.withoutFrontMatter(notes), notes)
  eq("empty", Checks.withoutFrontMatter(""), "")
  eq("a word that isn't a key", Checks.withoutFrontMatter("---\nhello world\n---\n- a"), "---\nhello world\n---\n- a")
}

fun main() {
  aiKeys(); thumbs(); sharing(); selection(); todo(); signatures(); frontMatter()
  println("Checks.kt: $passed passed, $failed failed")
  if (failed > 0) kotlin.system.exitProcess(1)
}
