package com.acknar.curio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * The app itself: Curio from the user's Nextcloud, full screen. Nextcloud's own top
 * bar is hidden on the Curio page and an "App settings" entry is added to Curio's
 * sidebar (assets/ui/inject/curio-page.js), so it reads as one app. The first request
 * carries the app password as HTTP Basic auth, which opens a Nextcloud session, so
 * the user signs in only once (in ConnectActivity).
 *
 * The page gets a deliberately small bridge (CurioPage below): it never exposes the
 * app password or native HTTP, because the page also hosts third-party embeds.
 */
public class MainActivity extends Activity {
	private static final int PICK_FILE = 41;
	private static final long RELOGIN_GAP_MS = 60_000;

	private WebView web;
	private FrameLayout root;
	private String server = "";
	private String host = "";
	private ValueCallback<Uri[]> pendingChooser;
	private long lastLoadAt = 0;
	private long lastReloginAt = 0;
	private String injectJs = "";

	@SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		server = Prefs.server(this);
		JSONObject cfg = Prefs.get(this);
		if (server.isEmpty() || cfg.optString("appPassword", "").isEmpty()) {
			startActivity(new Intent(this, ConnectActivity.class));
			finish();
			return;
		}
		host = Uri.parse(server).getHost();
		injectJs = Assets.read(this, "ui/inject/curio-page.js");

		root = new FrameLayout(this);
		web = new WebView(this);
		root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
		setContentView(root);
		Ui.fitSystemBars(root);
		Ui.applyLook(this, root, Prefs.get(this).optJSONObject("look"));

		WebSettings s = web.getSettings();
		s.setJavaScriptEnabled(true);
		s.setDomStorageEnabled(true);
		s.setMediaPlaybackRequiresUserGesture(false);
		s.setAllowFileAccess(false);
		CookieManager.getInstance().setAcceptCookie(true);
		web.addJavascriptInterface(new CurioPage(), "CurioAndroid");

		web.setWebViewClient(new WebViewClient() {
			@Override
			public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
				Uri u = request.getUrl();
				if (host != null && host.equalsIgnoreCase(u.getHost())) return false;
				openExternal(u);
				return true;
			}

			@Override
			public void onPageCommitVisible(WebView view, String url) {
				inject();
			}

			@Override
			public void onPageFinished(WebView view, String url) {
				inject();
				// The session expired and Nextcloud sent us to its login page: sign in
				// again with the app password instead of asking the user.
				if (url != null && url.contains("/login") && !url.contains("/login/v2")
						&& System.currentTimeMillis() - lastReloginAt > RELOGIN_GAP_MS) {
					lastReloginAt = System.currentTimeMillis();
					loadCurio();
				}
			}

			@Override
			public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
				if (request.isForMainFrame()) showOffline();
			}
		});
		web.setWebChromeClient(new WebChromeClient() {
			@Override
			public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
				if (pendingChooser != null) pendingChooser.onReceiveValue(null);
				pendingChooser = callback;
				try {
					startActivityForResult(params.createIntent(), PICK_FILE);
				} catch (ActivityNotFoundException e) {
					pendingChooser = null;
					return false;
				}
				return true;
			}
		});
		// CSV exports and other downloads: saved to Downloads with the session cookie,
		// since the server only serves them to the signed-in user.
		web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
			try {
				DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
				String cookie = CookieManager.getInstance().getCookie(url);
				if (cookie != null) req.addRequestHeader("Cookie", cookie);
				req.addRequestHeader("User-Agent", userAgent);
				String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
				req.setTitle(name);
				req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
				req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
				((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
				Toast.makeText(this, name, Toast.LENGTH_SHORT).show();
			} catch (Exception e) {
				Toast.makeText(this, "Download failed", Toast.LENGTH_SHORT).show();
			}
		});

		if (savedInstanceState != null) web.restoreState(savedInstanceState);
		else loadCurio();
		// First start after connecting: the introduction opens over Curio.
		if (savedInstanceState == null && !cfg.optBoolean("introDone", false)) {
			startActivity(new Intent(this, IntroActivity.class));
		}
	}

	private void loadCurio() {
		Map<String, String> headers = new HashMap<>();
		JSONObject cfg = Prefs.get(this);
		String raw = cfg.optString("user", "") + ":" + cfg.optString("appPassword", "");
		headers.put("Authorization", "Basic " + Base64.encodeToString(raw.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
		lastLoadAt = System.currentTimeMillis();
		web.loadUrl(server + "/index.php/apps/curio/", headers);
	}

	private void inject() {
		if (web != null && !injectJs.isEmpty()) web.evaluateJavascript(injectJs, null);
	}

	private void showOffline() {
		String html = Assets.read(this, "ui/offline.html");
		web.loadDataWithBaseURL("file:///android_asset/ui/", html, "text/html", "utf-8", null);
	}

	private void openExternal(Uri u) {
		try {
			startActivity(new Intent(Intent.ACTION_VIEW, u));
		} catch (ActivityNotFoundException e) {
			Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
		}
	}

	@Override
	protected void onResume() {
		super.onResume();
		if (web == null) return;
		// Something was clipped from the share menu since the board was loaded: refresh it.
		long clipped = Prefs.get(this).optLong("clipStamp", 0);
		if (clipped > lastLoadAt) {
			lastLoadAt = System.currentTimeMillis();
			web.evaluateJavascript("window.__curioAndroidRefresh&&window.__curioAndroidRefresh()", null);
		}
	}

	@Override
	protected void onSaveInstanceState(Bundle outState) {
		super.onSaveInstanceState(outState);
		if (web != null) web.saveState(outState);
	}

	@Override
	protected void onActivityResult(int requestCode, int resultCode, Intent data) {
		if (requestCode == PICK_FILE && pendingChooser != null) {
			pendingChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
			pendingChooser = null;
			return;
		}
		super.onActivityResult(requestCode, resultCode, data);
	}

	@Override
	public void onBackPressed() {
		if (web == null) {
			super.onBackPressed();
			return;
		}
		// Close Curio's open dialog or sidebar first, like the Escape key does on desktop.
		web.evaluateJavascript("window.__curioAndroidBack?window.__curioAndroidBack():'none'", value -> {
			if ("\"closed\"".equals(value)) return;
			if (web.canGoBack()) web.goBack();
			else moveTaskToBack(true);
		});
	}

	@Override
	protected void onPause() {
		super.onPause();
		CookieManager.getInstance().flush();
	}

	@Override
	protected void onDestroy() {
		if (web != null) {
			root.removeView(web);
			web.destroy();
		}
		super.onDestroy();
	}

	/** What the Curio page may call. Nothing here returns data or touches credentials. */
	private final class CurioPage {
		@JavascriptInterface
		public void openAppSettings() {
			runOnUiThread(() -> startActivity(new Intent(MainActivity.this, SettingsActivity.class)));
		}

		/** Curio's current theme, colours and language, reused by the app's own screens. */
		@JavascriptInterface
		public void syncLook(String json) {
			try {
				JSONObject in = new JSONObject(json);
				JSONObject look = new JSONObject();
				for (String k : new String[] { "theme", "primary", "bg", "surface", "lang" }) {
					String v = in.optString(k, "");
					if (v.length() <= 64) look.put(k, v);
				}
				JSONObject patch = new JSONObject();
				patch.put("look", look);
				Prefs.merge(MainActivity.this, patch);
				runOnUiThread(() -> Ui.applyLook(MainActivity.this, root, look));
			} catch (Exception ignored) {
				// malformed: ignore
			}
		}

		@JavascriptInterface
		public void retry() {
			runOnUiThread(MainActivity.this::loadCurio);
		}
	}
}
