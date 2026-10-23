package com.acknar.curio;

import android.content.Context;
import android.util.Base64;
import android.webkit.CookieManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Native HTTP for the web UI. Requests made here are not subject to CORS, can set
 * any User-Agent, can carry the cookies of a site the user signed into inside the
 * app (Instagram, Facebook...), and leave from the phone's own connection, which is
 * why they get the content a datacentre-hosted Nextcloud is refused.
 *
 * Request spec (JSON):
 *   method, url, headers{}, body | bodyBase64, timeoutMs, maxBytes,
 *   responseType: "text" (default) | "base64" | "none",
 *   cookies: true to send CookieManager cookies for each hop,
 *   followRedirects: true (default),
 *   multipart: { fields{}, file: { fromUrl, fromHeaders{}, fromCookies, shared (index),
 *                field, filename, mime, expect ("image/", "video/"...), maxBytes } }
 * Result: { status, url (final), contentType, headers{}, body | bodyBase64 } or { error, message }.
 */
final class Http {
	static final String UA_MOBILE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
	private static final int DEFAULT_MAX = 8 * 1024 * 1024;
	private static final int MAX_REDIRECTS = 8;

	interface SharedSource {
		/** Opens the stream for a shared file and reports its mime type in mimeOut[0]. */
		InputStream open(int index, String[] mimeOut) throws IOException;
	}

	private Http() {}

	static JSONObject execute(Context ctx, JSONObject spec, SharedSource shared) {
		try {
			return run(spec, shared);
		} catch (Exception e) {
			return error("network", e.getClass().getSimpleName() + ": " + e.getMessage());
		}
	}

	private static JSONObject run(JSONObject spec, SharedSource shared) throws IOException, JSONException {
		String method = spec.optString("method", "GET").toUpperCase(Locale.ROOT);
		String url = spec.getString("url");
		int timeout = spec.optInt("timeoutMs", 20000);
		int maxBytes = spec.optInt("maxBytes", DEFAULT_MAX);
		boolean cookies = spec.optBoolean("cookies", false);
		boolean follow = spec.optBoolean("followRedirects", true);
		String responseType = spec.optString("responseType", "text");
		JSONObject headers = spec.optJSONObject("headers");

		byte[] body = null;
		String contentType = null;
		JSONObject multipart = spec.optJSONObject("multipart");
		if (multipart != null) {
			String boundary = "----CurioBoundary" + UUID.randomUUID().toString().replace("-", "");
			Object built = buildMultipart(multipart, boundary, shared);
			if (built instanceof JSONObject) return (JSONObject) built;
			body = (byte[]) built;
			contentType = "multipart/form-data; boundary=" + boundary;
		} else if (spec.has("bodyBase64")) {
			body = Base64.decode(spec.getString("bodyBase64"), Base64.DEFAULT);
		} else if (spec.has("body") && !spec.isNull("body")) {
			body = spec.getString("body").getBytes(StandardCharsets.UTF_8);
		}

		HttpURLConnection conn = null;
		for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
			conn = (HttpURLConnection) new URL(url).openConnection();
			conn.setInstanceFollowRedirects(false);
			conn.setConnectTimeout(timeout);
			conn.setReadTimeout(timeout);
			conn.setRequestMethod(method);
			conn.setRequestProperty("User-Agent", UA_MOBILE);
			if (headers != null) {
				Iterator<String> it = headers.keys();
				while (it.hasNext()) {
					String k = it.next();
					conn.setRequestProperty(k, headers.getString(k));
				}
			}
			if (cookies) {
				String c = CookieManager.getInstance().getCookie(url);
				if (c != null && !c.isEmpty()) conn.setRequestProperty("Cookie", c);
			}
			if (body != null) {
				conn.setDoOutput(true);
				if (contentType != null) conn.setRequestProperty("Content-Type", contentType);
				conn.setFixedLengthStreamingMode(body.length);
				try (OutputStream os = conn.getOutputStream()) {
					os.write(body);
				}
			}
			int code = conn.getResponseCode();
			if (follow && code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
				url = new URL(new URL(url), conn.getHeaderField("Location")).toString();
				conn.disconnect();
				// A redirected POST becomes a GET, like a browser.
				if (code != 307 && code != 308) {
					method = "GET";
					body = null;
					contentType = null;
				}
				continue;
			}
			break;
		}

		JSONObject out = new JSONObject();
		int status = conn.getResponseCode();
		out.put("status", status);
		out.put("url", url);
		String ct = conn.getContentType();
		out.put("contentType", ct == null ? "" : ct);
		JSONObject hdrs = new JSONObject();
		for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
			if (e.getKey() == null || e.getValue() == null || e.getValue().isEmpty()) continue;
			hdrs.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue().get(e.getValue().size() - 1));
		}
		out.put("headers", hdrs);

		if (!"none".equals(responseType) && !"HEAD".equals(method)) {
			InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
			byte[] data = in == null ? new byte[0] : readAll(in, maxBytes);
			if ("base64".equals(responseType)) {
				out.put("bodyBase64", Base64.encodeToString(data, Base64.NO_WRAP));
			} else {
				out.put("body", new String(data, charsetOf(ct)));
			}
		}
		conn.disconnect();
		return out;
	}

	/** Returns the multipart body bytes, or an error JSONObject if the file could not be read. */
	private static Object buildMultipart(JSONObject mp, String boundary, SharedSource shared) throws IOException, JSONException {
		ByteArrayOutputStream bos = new ByteArrayOutputStream();
		JSONObject fields = mp.optJSONObject("fields");
		if (fields != null) {
			Iterator<String> it = fields.keys();
			while (it.hasNext()) {
				String k = it.next();
				write(bos, "--" + boundary + "\r\n");
				write(bos, "Content-Disposition: form-data; name=\"" + k + "\"\r\n\r\n");
				write(bos, fields.getString(k) + "\r\n");
			}
		}
		JSONObject file = mp.optJSONObject("file");
		if (file != null) {
			int max = file.optInt("maxBytes", 32 * 1024 * 1024);
			String expect = file.optString("expect", "");
			String[] mime = new String[] { file.optString("mime", "") };
			byte[] data;
			if (file.has("shared")) {
				if (shared == null) return error("source", "No shared file");
				try (InputStream in = shared.open(file.getInt("shared"), mime)) {
					data = readAll(in, max + 1);
				}
			} else {
				JSONObject fetch = new JSONObject();
				fetch.put("url", file.getString("fromUrl"));
				fetch.put("responseType", "base64");
				fetch.put("maxBytes", max + 1);
				fetch.put("cookies", file.optBoolean("fromCookies", false));
				if (file.has("fromHeaders")) fetch.put("headers", file.getJSONObject("fromHeaders"));
				JSONObject res = run(fetch, null);
				int st = res.optInt("status", 0);
				if (st < 200 || st >= 300) return error("source", "Download failed: HTTP " + st);
				data = Base64.decode(res.getString("bodyBase64"), Base64.DEFAULT);
				String ct = res.optString("contentType", "");
				if (!ct.isEmpty()) mime[0] = ct.split(";")[0].trim();
			}
			if (data.length == 0) return error("source", "Empty file");
			if (data.length > max) return error("too-large", "File is larger than " + (max / (1024 * 1024)) + " MB");
			if (mime[0] == null || mime[0].isEmpty() || "application/octet-stream".equals(mime[0])) {
				mime[0] = sniff(data, file.optString("mime", "application/octet-stream"));
			}
			if (!expect.isEmpty() && !mime[0].startsWith(expect)) {
				String sniffed = sniff(data, mime[0]);
				if (!sniffed.startsWith(expect)) return error("type", "Not " + expect + " (" + mime[0] + ")");
				mime[0] = sniffed;
			}
			String filename = file.optString("filename", "clip");
			write(bos, "--" + boundary + "\r\n");
			write(bos, "Content-Disposition: form-data; name=\"" + file.optString("field", "file") + "\"; filename=\"" + filename.replace("\"", "") + "\"\r\n");
			write(bos, "Content-Type: " + mime[0] + "\r\n\r\n");
			bos.write(data);
			write(bos, "\r\n");
		}
		write(bos, "--" + boundary + "--\r\n");
		return bos.toByteArray();
	}

	/** Magic-number sniffing for the formats Curio accepts. */
	static String sniff(byte[] d, String fallback) {
		if (d.length >= 3 && (d[0] & 0xff) == 0xFF && (d[1] & 0xff) == 0xD8 && (d[2] & 0xff) == 0xFF) return "image/jpeg";
		if (d.length >= 8 && (d[0] & 0xff) == 0x89 && d[1] == 'P' && d[2] == 'N' && d[3] == 'G') return "image/png";
		if (d.length >= 6 && d[0] == 'G' && d[1] == 'I' && d[2] == 'F') return "image/gif";
		if (d.length >= 12 && d[0] == 'R' && d[1] == 'I' && d[2] == 'F' && d[3] == 'F' && d[8] == 'W' && d[9] == 'E' && d[10] == 'B' && d[11] == 'P') return "image/webp";
		if (d.length >= 12 && d[4] == 'f' && d[5] == 't' && d[6] == 'y' && d[7] == 'p') {
			String brand = new String(d, 8, 4, StandardCharsets.US_ASCII);
			if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
			if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) return "image/heic";
			if (brand.startsWith("qt")) return "video/quicktime";
			return "video/mp4";
		}
		if (d.length >= 4 && (d[0] & 0xff) == 0x1A && (d[1] & 0xff) == 0x45 && (d[2] & 0xff) == 0xDF && (d[3] & 0xff) == 0xA3) return "video/webm";
		if (d.length >= 5 && d[0] == '%' && d[1] == 'P' && d[2] == 'D' && d[3] == 'F') return "application/pdf";
		return fallback;
	}

	static byte[] readAll(InputStream in, int max) throws IOException {
		ByteArrayOutputStream bos = new ByteArrayOutputStream();
		byte[] buf = new byte[16384];
		int n;
		int total = 0;
		while ((n = in.read(buf)) != -1) {
			int take = Math.min(n, max - total);
			if (take > 0) bos.write(buf, 0, take);
			total += n;
			if (total >= max) break;
		}
		in.close();
		return bos.toByteArray();
	}

	private static final Pattern CHARSET = Pattern.compile("charset=([\\w.:-]+)", Pattern.CASE_INSENSITIVE);

	private static Charset charsetOf(String ct) {
		if (ct != null) {
			Matcher m = CHARSET.matcher(ct);
			if (m.find()) {
				try {
					return Charset.forName(m.group(1));
				} catch (Exception ignored) {
					// fall through to UTF-8
				}
			}
		}
		return StandardCharsets.UTF_8;
	}

	private static void write(ByteArrayOutputStream bos, String s) throws IOException {
		bos.write(s.getBytes(StandardCharsets.UTF_8));
	}

	static JSONObject error(String code, String message) {
		JSONObject o = new JSONObject();
		try {
			o.put("error", code);
			o.put("message", message == null ? "" : message);
		} catch (JSONException ignored) {
			// cannot happen with string values
		}
		return o;
	}
}
