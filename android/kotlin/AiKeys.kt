// The optional AI features on the phone (Build 51): each service's key, and sending a request with it.
// Keys never go in the notes folder (which syncs) or the page: they are encrypted with a key that
// Android's Keystore holds for this app alone (AES-GCM; it never leaves the Keystore), and only the
// encrypted bytes are kept, in this app's own settings ("lean_ai"). The page can save, remove or ask
// whether there is one, never read it back. The request itself is built by the app's Rust code (core
// ai.rs, the same as on Windows); here it is only sent: https only (a program on the home network
// over http would need Android's "cleartext" allowance for the whole app, so not now).

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

  /** Save (empty: remove) one service's key. "" when done, else why not. */
  fun set(ctx: Context, service: String, key: String): String {
    if (service !in SERVICES) return "unknown AI service"
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val k = key.trim()
    if (k.isEmpty()) { prefs.edit().remove(service).apply(); return "" }
    if (!keyOk(k)) return "That key has spaces, quotes or line breaks in it. Copy it again from the service's page."
    return try {
      val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secret()) }
      val sealed = c.iv + c.doFinal(k.toByteArray(Charsets.UTF_8))
      prefs.edit().putString(service, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
      ""
    } catch (e: Exception) { "The phone couldn't keep the key (${e.javaClass.simpleName})." }
  }

  fun has(ctx: Context, service: String) = read(ctx, service) != null

  private fun read(ctx: Context, service: String): String? {
    val b64 = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(service, null) ?: return null
    return try {
      val sealed = Base64.decode(b64, Base64.NO_WRAP)
      val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, sealed, 0, 12)) }
      String(c.doFinal(sealed, 12, sealed.size - 12), Charsets.UTF_8).takeIf { it.isNotEmpty() }
    } catch (e: Exception) { null }
  }

  /** Send one request (JSON from core ai.rs: method, url, auth, headers, body, key_required). Runs on
   *  the calling (background) thread; gives {status, body} or {error}. */
  fun send(ctx: Context, service: String, reqJson: String): JSONObject {
    val out = JSONObject()
    try {
      val req = JSONObject(reqJson)
      val url = req.getString("url")
      if (!url.startsWith("https://")) {
        return out.put("error", "On the phone only services on the internet (https://) work for now, not a program on this computer or your home network.")
      }
      val auth = req.optString("auth", "")
      val key = if (auth.isNotEmpty()) read(ctx, service) else null
      if (auth.isNotEmpty() && key == null && req.optBoolean("key_required")) {
        return out.put("error", "No key is saved for this service on this phone yet. Add it in Settings → AI.")
      }
      val con = URL(url).openConnection() as HttpURLConnection
      con.instanceFollowRedirects = false
      con.connectTimeout = 15_000
      con.readTimeout = 120_000
      con.requestMethod = if (req.optString("method") == "GET") "GET" else "POST"
      con.setRequestProperty("Accept", "application/json")
      val hs = req.optJSONArray("headers")
      if (hs != null) for (i in 0 until hs.length()) {
        val h = hs.getJSONArray(i)
        val k = h.getString(0); val v = h.getString(1)
        if (k.all { it.isLetterOrDigit() || it == '-' } && !v.contains('\n') && !v.contains('\r')) con.setRequestProperty(k, v)
      }
      if (key != null) {
        if (auth == "x-api-key") con.setRequestProperty("x-api-key", key) else con.setRequestProperty("Authorization", "Bearer $key")
      }
      val body = if (req.isNull("body")) null else req.optString("body", null)
      if (body != null) {
        con.doOutput = true
        con.setRequestProperty("Content-Type", "application/json")
        con.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      val status = con.responseCode
      val stream = if (status >= 400) con.errorStream else con.inputStream
      val bytes = stream?.use { s ->
        val buf = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(16384)
        while (true) {
          val n = s.read(chunk)
          if (n < 0) break
          buf.write(chunk, 0, n)
          if (buf.size() > 8_000_000) break
        }
        buf.toByteArray()
      } ?: ByteArray(0)
      con.disconnect()
      out.put("status", status).put("body", String(bytes, Charsets.UTF_8))
    } catch (e: java.net.UnknownHostException) {
      out.put("error", "Couldn't reach the service. Are you online?")
    } catch (e: java.net.SocketTimeoutException) {
      out.put("error", "The service took too long to answer. Try again.")
    } catch (e: Exception) {
      out.put("error", "Couldn't reach the service (${e.javaClass.simpleName}).")
    }
    return out
  }
}
