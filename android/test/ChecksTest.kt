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

// ---- today's journal file and title (Checks.formatDate / journalRelPath; JournalWidget.todayFile and
// todayTitle). The cases are the core's own (core/tests/vault.rs journal_names and user_style_config,
// core/tests/features.rs folder_settings_stay_inside_the_notes_folder), so the widget reads the very file
// the app writes notes to (audit finding 17).

/** A Calendar on that day (month 1 to 12), as JournalWidget's Calendar.getInstance() gives today. */
fun day(y: Int, m: Int, d: Int): java.util.Calendar = java.util.Calendar.getInstance().apply { clear(); set(y, m - 1, d, 12, 0) }

fun journalDates() {
  // core vault.rs journal_names: Logseq's default title "MMM do, yyyy" and file "yyyy_MM_dd"
  eq("title, 25th", Checks.formatDate("MMM do, yyyy", day(2026, 10, 25)), "Oct 25th, 2026")
  eq("title, 1st", Checks.formatDate("MMM do, yyyy", day(2026, 10, 1)), "Oct 1st, 2026")
  eq("title, 12th", Checks.formatDate("MMM do, yyyy", day(2026, 10, 12)), "Oct 12th, 2026")
  eq("title, 22nd", Checks.formatDate("MMM do, yyyy", day(2026, 10, 22)), "Oct 22nd, 2026")
  eq("title, 23rd", Checks.formatDate("MMM do, yyyy", day(2026, 10, 23)), "Oct 23rd, 2026")
  eq("default file", Checks.journalRelPath("journals", "yyyy_MM_dd", day(2026, 1, 5)), "journals/2026_01_05.md")
  eq("weekday, Sunday", Checks.formatDate("EEEE, yyyy-MM-dd", day(2026, 10, 25)), "Sunday, 2026-10-25")
  // core vault.rs user_style_config: journals in "Diary", full month names in titles and files
  eq("Diary, full month names", Checks.journalRelPath("Diary", "MMMM do, yyyy", day(2026, 10, 25)), "Diary/October 25th, 2026.md")
  eq("full month title", Checks.formatDate("MMMM do, yyyy", day(2026, 10, 26)), "October 26th, 2026")
  // core features.rs folder_settings_stay_inside_the_notes_folder: a name that would leave the folder
  eq("quoted ../ falls back", Checks.journalRelPath("journals", "'../x'yyyy", day(2026, 10, 30)), "journals/2026_10_30.md")
  // the core's other rules: ordinals, short tokens, quotes, every weekday
  eq("11th, 13th, 21st, 31st, 2nd, 3rd", listOf(11, 13, 21, 31, 2, 3, 111, 112).map { Checks.ordinal(it) }, listOf("11th", "13th", "21st", "31st", "2nd", "3rd", "111th", "112th"))
  eq("short tokens", Checks.formatDate("yy M d E EE EEE", day(2026, 3, 7)), "26 3 7 Sat Sat Sat")
  eq("two-digit tokens", Checks.formatDate("yy/MM/dd", day(2009, 1, 2)), "09/01/02")
  eq("a four-digit year from a small one", Checks.formatDate("yyyy", day(987, 6, 1)), "0987")
  eq("quoted words stay as they are", Checks.formatDate("'Day' d 'of' MMMM", day(2026, 11, 23)), "Day 23 of November")
  eq("an empty quote", Checks.formatDate("yyyy''MM", day(2026, 11, 23)), "202611")
  eq("an unclosed quote runs to the end", Checks.formatDate("yyyy 'MM dd", day(2026, 11, 23)), "2026 MM dd")
  eq("other characters as they are", Checks.formatDate("yyyy.MM.dd — wk", day(2026, 11, 23)), "2026.11.23 — wk")
  eq("every weekday", (22..28).map { Checks.formatDate("EEEE", day(2026, 11, it)) }, listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"))
  eq("a leap day", Checks.formatDate("EEE MMM do yyyy", day(2028, 2, 29)), "Tue Feb 29th 2028")
  eq("December", Checks.formatDate("MMMM MMM", day(2026, 12, 31)), "December Dec")
  // file names that would leave the journals folder: the default name instead (as the core)
  eq("an empty format", Checks.journalRelPath("journals", "", day(2026, 11, 23)), "journals/2026_11_23.md")
  eq("a name starting with a dot", Checks.journalRelPath("journals", "'.'yyyy", day(2026, 11, 23)), "journals/2026_11_23.md")
  eq("a slash in the name", Checks.journalRelPath("journals", "yyyy/MM", day(2026, 11, 23)), "journals/2026_11_23.md")
  eq("a backslash in the name", Checks.journalRelPath("journals", "yyyy'\\'MM", day(2026, 11, 23)), "journals/2026_11_23.md")
  eq("a colon in the name", Checks.journalRelPath("journals", "'C:'yyyy", day(2026, 11, 23)), "journals/2026_11_23.md")
  eq("a NUL in the name", Checks.journalRelPath("journals", "yyyy\u0000", day(2026, 11, 23)), "journals/2026_11_23.md")
  eq("a dot inside the name is fine", Checks.journalRelPath("journals", "yyyy.MM.dd", day(2026, 11, 23)), "journals/2026.11.23.md")
  // a journals folder that isn't inside the notes folder (the core never sends one): no file at all
  eq("a .. folder", Checks.journalRelPath("../outside", "yyyy_MM_dd", day(2026, 11, 23)), null)
  eq("a .. inside the folder", Checks.journalRelPath("a/../../b", "yyyy_MM_dd", day(2026, 11, 23)), null)
  eq("a .. after a backslash", Checks.journalRelPath("a\\..", "yyyy_MM_dd", day(2026, 11, 23)), null)
  eq("a folder from the top", Checks.journalRelPath("/sdcard/x", "yyyy_MM_dd", day(2026, 11, 23)), null)
  eq("a folder inside a folder", Checks.journalRelPath("notes/Diary", "yyyy_MM_dd", day(2026, 11, 23)), "notes/Diary/2026_11_23.md")
}

fun main() {
  aiKeys(); thumbs(); sharing(); selection(); todo(); signatures(); frontMatter(); updateSignature(); journalDates()
  println("Checks.kt: $passed passed, $failed failed")
  if (failed > 0) kotlin.system.exitProcess(1)
}

// ---- the update's signature file (Checks.apkSigProblem; MainActivity.downloadUpdate)

// Made once (Nov 21, 2026) with scripts/update_sig.py and a throw-away key (its private half was
// deleted; it signs nothing real): `sign-update key.pem thinky.apk thinky-apk.sig 1.2.3 57`, where
// thinky.apk held FIXTURE_APK. So this checks the phone reads exactly what CI writes.
const val FIXTURE_KEY = "GujNI3y9EL2II7ODeal1Npt7J82Fnpclbsh8TiJmf8L+zsL+2wqRHDMc95BPM59ERcb8vf65V7SN8GcspvjpjQ=="
const val FIXTURE_APK = "not really an app: the bytes the signature test checks\n"
const val FIXTURE_SHA = "5a6db7aee11d103046c636bef811afb4b7173850d2e8ebe2ef52e04234d8cf7f"
const val FIXTURE_SIG = "AvP/YtLOLoeKOgPv/4OK/YYTDtkSO6ymQ/ET9g5z8s5GDWL5O2AWUNVGHYswQFhcfQk6dzg84IK7tmDLTpsAkw=="
val FIXTURE = Checks.UpdateSig("thinky.apk", "1.2.3", 57L, FIXTURE_SHA, FIXTURE_SIG)

/** Java's DER signature → r‖s (what update_sig.py der_to_raw does), for signing in the tests. */
fun derToRaw(der: ByteArray): ByteArray {
  var i = 2 // after SEQUENCE and its (short) length
  val out = ByteArray(64)
  for (k in 0..1) {
    val n = der[i + 1].toInt()
    val v = java.math.BigInteger(1, der.copyOfRange(i + 2, i + 2 + n)).toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it }
    System.arraycopy(v, 0, out, 32 * k + 32 - v.size, v.size)
    i += 2 + n
  }
  return out
}

/** A fresh P-256 key, its public half as the app holds it (base64 X‖Y), and a signer with it. */
class TestKey {
  val pair: java.security.KeyPair = java.security.KeyPairGenerator.getInstance("EC").apply {
    initialize(java.security.spec.ECGenParameterSpec("secp256r1"))
  }.generateKeyPair()
  val pub: String = java.util.Base64.getEncoder().encodeToString(pair.public.encoded.copyOfRange(27, 91)) // the DER's last 64 bytes: X‖Y
  fun sign(text: String): String = java.security.Signature.getInstance("SHA256withECDSA").run {
    initSign(pair.private)
    update(text.toByteArray(Charsets.UTF_8))
    java.util.Base64.getEncoder().encodeToString(derToRaw(sign()))
  }
  /** A whole signature file for `sha`, as CI would make it. */
  fun file(sha: String, version: String = "0.7.0", build: Long = 56L, name: String = "thinky.apk") =
    Checks.UpdateSig(name, version, build, sha, sign(Checks.updateText(name, version, build, sha)))
}

fun updateSignature() {
  // the bits it's made of
  eq("versions read", Checks.parseVersion("0.6.4"), Triple(0L, 6L, 4L))
  for (bad in listOf(null, "", "0.6", "0.6.4.1", "0.6.x", "0.6.-1", " 0.6.4", "0.6.4 ", "1..2", "0.6.1234567890", "v0.6.4", "0.6.4\n"))
    eq("not a version: '$bad'", Checks.parseVersion(bad), null)
  eq("higher middle", Checks.higherVersion(Triple(0, 7, 0), Triple(0, 6, 9)), true)
  eq("higher last", Checks.higherVersion(Triple(0, 6, 5), Triple(0, 6, 4)), true)
  eq("higher first", Checks.higherVersion(Triple(1, 0, 0), Triple(0, 99, 99)), true)
  eq("the same isn't higher", Checks.higherVersion(Triple(0, 6, 4), Triple(0, 6, 4)), false)
  eq("lower isn't higher", Checks.higherVersion(Triple(0, 5, 99), Triple(0, 6, 0)), false)
  eq("10 is above 9 (numbers, not letters)", Checks.higherVersion(Triple(0, 10, 0), Triple(0, 9, 0)), true)
  eq("the signed text (core update_text)", Checks.updateText("thinky.apk", "0.7.0", 56, "ab"), "thinky-update-2\nthinky.apk\n0.7.0\nbuild 56\nab\n")
  eq("base64", Checks.base64Decode("aGk=")?.toString(Charsets.UTF_8), "hi")
  eq("base64 without the =", Checks.base64Decode("aGk")?.toString(Charsets.UTF_8), "hi")
  eq("not base64", Checks.base64Decode("a-k="), null)
  eq("base64 with a space inside", Checks.base64Decode("aG k="), null)
  eq("hex", Checks.hexBytes("00ff10")?.toList(), listOf<Byte>(0, -1, 16))
  eq("odd hex", Checks.hexBytes("abc"), null)
  eq("not hex", Checks.hexBytes("zz"), null)
  eq("hex back", Checks.hex(byteArrayOf(0, -1, 16)), "00ff10")
  eq("sha256 of the fixture", Checks.sha256Hex(FIXTURE_APK.byteInputStream()), FIXTURE_SHA)
  eq("sha256 of nothing", Checks.sha256Hex(ByteArray(0).inputStream()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  eq("the DER form keeps a top-bit r positive", Checks.rawToDer(ByteArray(64) { 0x80.toByte() })!!.toList().subList(0, 5), listOf<Byte>(0x30, 70, 2, 33, 0))
  eq("the DER form drops leading zeros", Checks.rawToDer(ByteArray(32) + ByteArray(31) + byteArrayOf(5))!!.toList(), listOf<Byte>(0x30, 6, 2, 1, 0, 2, 1, 5))
  eq("r‖s must be 64 bytes", Checks.rawToDer(ByteArray(63)), null)

  // the key built into the app
  check("the fixture's key reads", Checks.updateKey(FIXTURE_KEY) != null)
  check("ci/update-key.pub (the real key) reads", Checks.updateKey(java.io.File(System.getProperty("repo", "."), "ci/update-key.pub").readText().trim()) != null)
  for (bad in listOf(null, "", "__UPDATE_KEY__", "AAAA", FIXTURE_KEY.dropLast(4), FIXTURE_KEY + "AAAA",
      java.util.Base64.getEncoder().encodeToString(ByteArray(64)), // all zeros: not a point on the curve
      java.util.Base64.getEncoder().encodeToString(ByteArray(64) { 1 })))
    eq("no key from '${bad?.take(12)}'", Checks.updateKey(bad), null)

  check("a fresh key's point is on the curve", Checks.onP256(Checks.base64Decode(TestKey().pub)!!))
  check("a point moved by one is off the curve", !Checks.onP256(Checks.base64Decode(FIXTURE_KEY)!!.also { it[63] = (it[63].toInt() xor 1).toByte() }))
  check("63 bytes isn't a point", !Checks.onP256(ByteArray(63)))

  // what CI makes (update_sig.py) checks out on the phone
  val key = Checks.updateKey(FIXTURE_KEY)
  eq("the fixture: genuine", Checks.apkSigProblem(key, FIXTURE, 57, "1.2.2", FIXTURE_SHA), null)
  eq("the fixture, checksum in capitals", Checks.apkSigProblem(key, FIXTURE.copy(sha256 = FIXTURE_SHA.uppercase()), 57, "1.2.2", FIXTURE_SHA.uppercase()), null)
  eq("the fixture, signature without its =", Checks.apkSigProblem(key, FIXTURE.copy(sig = FIXTURE_SIG.trimEnd('=')), 57, "1.2.2", FIXTURE_SHA), null)

  // every way it must be refused, each with its own reason
  fun refused(what: String, got: String?, says: String) = check("$what is refused ($got)", got != null && says in got)
  val other = "0".repeat(64)
  refused("no key in the app", Checks.apkSigProblem(null, FIXTURE, 57, "1.2.2", FIXTURE_SHA), "without the update key")
  refused("no signature file", Checks.apkSigProblem(key, null, 57, "1.2.2", FIXTURE_SHA), "no signature file")
  refused("a changed download", Checks.apkSigProblem(key, FIXTURE, 57, "1.2.2", other), "doesn’t match")
  refused("another build", Checks.apkSigProblem(key, FIXTURE, 58, "1.2.2", FIXTURE_SHA), "isn’t for build 58")
  refused("the same version", Checks.apkSigProblem(key, FIXTURE, 57, "1.2.3", FIXTURE_SHA), "isn’t newer")
  refused("an older version", Checks.apkSigProblem(key, FIXTURE, 57, "2.0.0", FIXTURE_SHA), "isn’t newer")
  refused("this app's version unreadable", Checks.apkSigProblem(key, FIXTURE, 57, null, FIXTURE_SHA), "can’t be read")
  refused("its version edited up", Checks.apkSigProblem(key, FIXTURE.copy(version = "1.2.4"), 57, "1.2.2", FIXTURE_SHA), "isn’t thinky’s")
  refused("its version unreadable", Checks.apkSigProblem(key, FIXTURE.copy(version = "1.2"), 57, "1.2.2", FIXTURE_SHA), "can’t be read")
  refused("its version missing", Checks.apkSigProblem(key, FIXTURE.copy(version = null), 57, "1.2.2", FIXTURE_SHA), "can’t be read")
  refused("its build edited", Checks.apkSigProblem(key, FIXTURE.copy(build = 58), 58, "1.2.2", FIXTURE_SHA), "isn’t thinky’s")
  refused("its build missing", Checks.apkSigProblem(key, FIXTURE.copy(build = null), 57, "1.2.2", FIXTURE_SHA), "isn’t for build")
  refused("a Windows file", Checks.apkSigProblem(key, FIXTURE.copy(file = "thinky-setup.exe"), 57, "1.2.2", FIXTURE_SHA), "not thinky.apk")
  refused("no file named", Checks.apkSigProblem(key, FIXTURE.copy(file = null), 57, "1.2.2", FIXTURE_SHA), "not thinky.apk")
  refused("the checksum edited to the download's", Checks.apkSigProblem(key, FIXTURE.copy(sha256 = other), 57, "1.2.2", other), "isn’t thinky’s")
  refused("a short checksum", Checks.apkSigProblem(key, FIXTURE.copy(sha256 = "abc"), 57, "1.2.2", "abc"), "isn’t valid")
  refused("a checksum that isn't hex", Checks.apkSigProblem(key, FIXTURE.copy(sha256 = "g".repeat(64)), 57, "1.2.2", "g".repeat(64)), "isn’t valid")
  refused("no checksum", Checks.apkSigProblem(key, FIXTURE.copy(sha256 = null), 57, "1.2.2", FIXTURE_SHA), "isn’t valid")
  refused("no signature", Checks.apkSigProblem(key, FIXTURE.copy(sig = null), 57, "1.2.2", FIXTURE_SHA), "isn’t thinky’s")
  refused("a signature that isn't base64", Checks.apkSigProblem(key, FIXTURE.copy(sig = "%%%"), 57, "1.2.2", FIXTURE_SHA), "isn’t thinky’s")
  refused("a short signature", Checks.apkSigProblem(key, FIXTURE.copy(sig = FIXTURE_SIG.substring(4)), 57, "1.2.2", FIXTURE_SHA), "isn’t thinky’s")
  refused("an all-zero signature", Checks.apkSigProblem(key, FIXTURE.copy(sig = java.util.Base64.getEncoder().encodeToString(ByteArray(64))), 57, "1.2.2", FIXTURE_SHA), "isn’t thinky’s")
  val flipped = Checks.base64Decode(FIXTURE_SIG)!!.also { it[40] = (it[40].toInt() xor 1).toByte() }
  refused("one bit of the signature changed", Checks.apkSigProblem(key, FIXTURE.copy(sig = java.util.Base64.getEncoder().encodeToString(flipped)), 57, "1.2.2", FIXTURE_SHA), "isn’t thinky’s")

  // another key: a file signed by anyone but the release job is refused
  val stranger = TestKey()
  refused("signed with another key", Checks.apkSigProblem(key, stranger.file(FIXTURE_SHA, "1.2.3", 57), 57, "1.2.2", FIXTURE_SHA), "isn’t thinky’s")
  // the old kind of text (thinky-setup.exe.sig's "lean-outliner-update") signed with the right key isn't accepted either
  val mine = TestKey()
  val oldKind = Checks.UpdateSig("thinky.apk", "0.7.0", 56, FIXTURE_SHA, mine.sign("lean-outliner-update\nthinky.apk\n0.7.0\n$FIXTURE_SHA\n"))
  refused("the old kind of signed text", Checks.apkSigProblem(Checks.updateKey(mine.pub), oldKind, 56, "0.6.4", FIXTURE_SHA), "isn’t thinky’s")

  // many fresh signatures (r and s of every shape: a top bit set, leading zero bytes) all check out,
  // and each is refused for any other build, version or checksum
  var good = 0
  repeat(200) { i ->
    val k = if (i % 20 == 0) TestKey() else mine
    val sha = Checks.sha256Hex("apk $i".byteInputStream())
    val f = k.file(sha, "0.7.$i", 56L + i)
    if (Checks.apkSigProblem(Checks.updateKey(k.pub), f, 56L + i, "0.6.4", sha) == null) good++
    else println("FAIL fresh signature $i: ${Checks.apkSigProblem(Checks.updateKey(k.pub), f, 56L + i, "0.6.4", sha)}")
  }
  eq("200 fresh signatures check out", good, 200)
}
