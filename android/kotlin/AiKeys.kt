// The optional AI features on the phone (Build 51): each service's key, and sending a request with it.
// Keys never go in the notes folder (which syncs) or the page: they are encrypted with a key that
// Android's Keystore holds for this app alone (AES-GCM; it never leaves the Keystore), and only the
// encrypted bytes are kept, in this app's own settings ("lean_ai"). The page can save, remove or ask
// whether there is one, never read it back. The request itself is built by the app's Rust code (core
// ai.rs, the same as on Windows); here it is only sent: https only (a program on the home network
// over http would need Android's "cleartext" allowance for the whole app, so not now).
// A key goes only to its own service (the outside review's claim 1): where it goes in the request is
// the service's (Checks.keyHeader, never the page's "auth"), and only to that service's fixed address
// (Checks.keyMayGo, the same rules as core ai::key_may_go); an "Other" service's key only to the address
// saved with it ("other_base" in "lean_ai", set by aiKeySetFor with the key).

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object AiKeys {
  private const val ALIAS = "thinky-ai-keys"
  private const val PREFS = "lean_ai"
  private val SERVICES = setOf("claude", "openai", "gemini", "openrouter", "ollama", "lmstudio", "other")

  private fun secret(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build())
    return gen.generateKey()
  }

  /** A key may go in a header: printable letters only, no quotes or spaces. */
  private fun keyOk(k: String) = k.isNotEmpty() && k.length <= 512 && k.all { it in '!'..'~' && it != '"' && it != '\\' }

  /** An "Other" service's address, kept with its key: its key goes only there. */
  private const val OTHER_BASE = "other_base"

  /** The most an answer may be: more is refused, not cut short (a cut answer would read as broken). */
  private const val MAX_ANSWER = 8_000_000

  /** Save (empty: remove) one service's key. "" when done, else why not. `base`: for "Other", the
   *  address its key may go to (kept with it; the page passes the address set up in Settings → AI);
   *  the other services' addresses are fixed (Checks.KEY_BASES), so theirs is ignored. */
  fun set(ctx: Context, service: String, key: String, base: String = ""): String {
    if (service !in SERVICES) return "unknown AI service"
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val k = key.trim()
    if (k.isEmpty()) {
      val e = prefs.edit().remove(service)
      if (service == "other") e.remove(OTHER_BASE)
      e.apply()
      return ""
    }
    if (!keyOk(k)) return "That key has spaces, quotes or line breaks in it. Copy it again from the service's page."
    val otherBase = if (service == "other") (Checks.checkBase(base)
      ?: return "Type the service's web address (https://…) first: the key is kept for that address only.") else null
    return try {
      val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secret()) }
      val sealed = c.iv + c.doFinal(k.toByteArray(Charsets.UTF_8))
      val e = prefs.edit().putString(service, Base64.encodeToString(sealed, Base64.NO_WRAP))
      if (otherBase != null) e.putString(OTHER_BASE, otherBase)
      e.apply()
      ""
    } catch (e: Exception) { "The phone couldn't keep the key (${e.javaClass.simpleName})." }
  }

  /** The address an "Other" service's key was saved for, or null. */
  private fun otherBase(ctx: Context): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(OTHER_BASE, null)

  fun has(ctx: Context, service: String) = read(ctx, service) != null

  private fun read(ctx: Context, service: String): String? {
    val b64 = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(service, null) ?: return null
    return try {
      val sealed = Base64.decode(b64, Base64.NO_WRAP)
      val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, sealed, 0, 12)) }
      String(c.doFinal(sealed, 12, sealed.size - 12), Charsets.UTF_8).takeIf { it.isNotEmpty() }
    } catch (e: Exception) { null }
  }

  /** Send one request (JSON from core ai.rs: method, url, headers, body, key_required; its "auth" is
   *  never used: the key's header is the service's own). Runs on the calling (background) thread; gives
   *  {status, body} or {error}. */
  fun send(ctx: Context, service: String, reqJson: String): JSONObject {
    val out = JSONObject()
    var con: HttpURLConnection? = null
    try {
      val req = JSONObject(reqJson)
      val url = req.getString("url")
      if (!url.startsWith("https://")) {
        return out.put("error", "On the phone only services on the internet (https://) work for now, not a program on this computer or your home network.")
      }
      val header = Checks.keyHeader(service)
      val key = if (header != null) read(ctx, service) else null
      if (header != null && key == null && req.optBoolean("key_required")) {
        return out.put("error", "No key is saved for this service on this phone yet. Add it in Settings → AI.")
      }
      // the key goes only to its own service's address (claim 1): never where a request says
      if (key != null && !Checks.keyMayGo(service, url, otherBase(ctx))) {
        return out.put("error", "That address isn't the one this service's key belongs to, so the key wasn't sent.")
      }
      val c = URL(url).openConnection() as HttpURLConnection
      con = c
      c.instanceFollowRedirects = false
      c.connectTimeout = 15_000
      c.readTimeout = 120_000
      c.requestMethod = if (req.optString("method") == "GET") "GET" else "POST"
      c.setRequestProperty("Accept", "application/json")
      val hs = req.optJSONArray("headers")
      if (hs != null) for (i in 0 until hs.length()) {
        val h = hs.getJSONArray(i)
        val k = h.getString(0); val v = h.getString(1)
        // (never a header that carries a key: only the service's own, below)
        if (k.equals("authorization", ignoreCase = true) || k.equals("x-api-key", ignoreCase = true)) continue
        if (k.all { it.isLetterOrDigit() || it == '-' } && !v.contains('\n') && !v.contains('\r')) c.setRequestProperty(k, v)
      }
      if (key != null) {
        if (header == "x-api-key") c.setRequestProperty("x-api-key", key) else c.setRequestProperty("Authorization", "Bearer $key")
      }
      val body = if (req.isNull("body")) null else req.optString("body", null)
      if (body != null) {
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      val status = c.responseCode
      val stream = if (status >= 400) c.errorStream else c.inputStream
      val bytes = stream?.use { s -> Checks.readAtMost(s, MAX_ANSWER) ?: return out.put("error", "The service's answer was too big (over 8 MB), so it wasn't used.") } ?: ByteArray(0)
      out.put("status", status).put("body", String(bytes, Charsets.UTF_8))
    } catch (e: java.net.UnknownHostException) {
      out.put("error", "Couldn't reach the service. Are you online?")
    } catch (e: java.net.SocketTimeoutException) {
      out.put("error", "The service took too long to answer. Try again.")
    } catch (e: Exception) {
      out.put("error", "Couldn't reach the service (${e.javaClass.simpleName}).")
    } finally {
      con?.disconnect()
    }
    return out
  }
}
