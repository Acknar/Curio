package com.acknar.curio;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The JavaScript interface the bundled pages talk to, exposed as window.Android and
 * wrapped by assets/ui/native.js. Calls arrive on a WebView binder thread; anything
 * slow runs on a worker and answers through CurioNative._resolve(id, json).
 */
class NativeBridge {
	/** Sites the user can sign into from Settings, with the cookie that proves a session. */
	static final String[][] SITES = {
		{ "instagram", "https://www.instagram.com", "sessionid" },
		{ "facebook", "https://www.facebook.com", "c_user" },
		{ "pinterest", "https://www.pinterest.com", "_pinterest_sess" },
		{ "tiktok", "https://www.tiktok.com", "sessionid" },
		{ "x", "https://x.com", "auth_token" },
	};

	private static final ExecutorService POOL = Executors.newCachedThreadPool();

	protected final WebShellActivity activity;
	protected final WebView web;

	NativeBridge(WebShellActivity activity, WebView web) {
		this.activity = activity;
		this.web = web;
	}

	@JavascriptInterface
	public String getConfig() {
		return Prefs.get(activity).toString();
	}

	@JavascriptInterface
	public void setConfig(String patchJson) {
		try {
			Prefs.merge(activity, new JSONObject(patchJson));
		} catch (JSONException ignored) {
			// malformed patch from the page: ignore
		}
	}

	/** The share intent payload; empty outside the share sheet. */
	@JavascriptInterface
	public String getShared() {
		return activity.sharedPayload().toString();
	}

	@JavascriptInterface
	public String appInfo() {
		JSONObject o = new JSONObject();
		try {
			PackageInfo pi = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
			o.put("version", pi.versionName);
			o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
			o.put("sdk", Build.VERSION.SDK_INT);
		} catch (Exception ignored) {
			// best-effort
		}
		return o.toString();
	}

	@JavascriptInterface
	public String siteSessions() {
		JSONObject o = new JSONObject();
		CookieManager cm = CookieManager.getInstance();
		for (String[] s : SITES) {
			String c = cm.getCookie(s[1]);
			try {
				o.put(s[0], c != null && (c.startsWith(s[2] + "=") || c.contains("; " + s[2] + "=")));
			} catch (JSONException ignored) {
				// constant keys
			}
		}
		return o.toString();
	}

	@JavascriptInterface
	public void clearSiteSessions() {
		CookieManager cm = CookieManager.getInstance();
		cm.removeAllCookies(null);
		cm.flush();
	}

	/** Expire the Nextcloud session cookies (on disconnect), keeping site sign-ins. */
	@JavascriptInterface
	public void clearServerSession() {
		String server = Prefs.server(activity);
		if (server.isEmpty()) return;
		CookieManager cm = CookieManager.getInstance();
		String c = cm.getCookie(server);
		if (c != null) {
			String path = Uri.parse(server).getPath();
			for (String part : c.split(";")) {
				String name = part.split("=", 2)[0].trim();
				if (name.isEmpty()) continue;
				cm.setCookie(server, name + "=; Max-Age=0; Path=/");
				if (path != null && path.length() > 1) cm.setCookie(server, name + "=; Max-Age=0; Path=" + path);
			}
		}
		cm.flush();
	}

	/** Async work: spec.op is "http" or "render". */
	@JavascriptInterface
	public void request(final String id, final String specJson) {
		final JSONObject spec;
		try {
			spec = new JSONObject(specJson);
		} catch (JSONException e) {
			resolve(id, Http.error("bad-request", e.getMessage()));
			return;
		}
		String op = spec.optString("op", "http");
		if ("render".equals(op)) {
			activity.runOnUiThread(() -> activity.renderer().render(spec, result -> resolve(id, result)));
			return;
		}
		POOL.execute(() -> resolve(id, Http.execute(activity, spec, activity.sharedSource())));
	}

	@JavascriptInterface
	public void close() {
		activity.runOnUiThread(activity::finish);
	}

	@JavascriptInterface
	public void toast(String msg) {
		activity.runOnUiThread(() -> Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show());
	}

	@JavascriptInterface
	public void openExternal(String url) {
		activity.runOnUiThread(() -> {
			try {
				activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
			} catch (ActivityNotFoundException e) {
				Toast.makeText(activity, "No app can open this link", Toast.LENGTH_SHORT).show();
			}
		});
	}

	/** Connected (or reconnected): open Curio and close the connection screen. */
	@JavascriptInterface
	public void openCurio() {
		activity.runOnUiThread(() -> {
			activity.startActivity(new Intent(activity, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
			activity.finish();
		});
	}

	/** Disconnected: back to the connection screen, closing everything else. */
	@JavascriptInterface
	public void openConnect() {
		activity.runOnUiThread(() -> {
			activity.startActivity(new Intent(activity, ConnectActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
			activity.finish();
		});
	}

	/** A reference was added from the share menu; Curio refreshes when next shown. */
	@JavascriptInterface
	public void clipped() {
		try {
			Prefs.merge(activity, new JSONObject().put("clipStamp", System.currentTimeMillis()));
		} catch (JSONException ignored) {
			// constant key
		}
	}

	/** Text of a bundled file: Curio's translations (curio/l10n/*.json) and the like. */
	@JavascriptInterface
	public String asset(String path) {
		if (path == null || path.contains("..") || !(path.startsWith("curio/") || path.startsWith("ui/"))) return "";
		return Assets.read(activity, path);
	}

	@JavascriptInterface
	public void openSiteLogin(String site) {
		for (String[] s : SITES) {
			if (s[0].equals(site)) {
				activity.runOnUiThread(() -> activity.startActivity(new Intent(activity, SiteLoginActivity.class)
						.putExtra(SiteLoginActivity.EXTRA_URL, s[1] + "/")
						.putExtra(SiteLoginActivity.EXTRA_SITE, s[0])));
				return;
			}
		}
	}

	/** Open the app's settings screen (from the share sheet). */
	@JavascriptInterface
	public void openSettings() {
		activity.runOnUiThread(() -> activity.startActivity(new Intent(activity, SettingsActivity.class)
				.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
	}

	@JavascriptInterface
	public void openIntro() {
		activity.runOnUiThread(() -> activity.startActivity(new Intent(activity, IntroActivity.class)));
	}

	void resolve(String id, JSONObject result) {
		final String js = "window.CurioNative&&CurioNative._resolve(" + JSONObject.quote(id) + "," + JSONObject.quote(result.toString()) + ")";
		web.post(() -> web.evaluateJavascript(js, null));
	}
}
