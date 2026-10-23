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
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
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
 * The Curio web app from the user's own Nextcloud, full screen. The first request
 * carries the app password as HTTP Basic auth, which Nextcloud accepts to open a
 * session, so the user is not asked to sign in a second time. Links that leave the
 * server (a reference's source page) open in the regular browser or the site's app.
 */
public class BoardsActivity extends Activity {
	private static final int PICK_FILE = 41;

	private WebView web;
	private String host = "";
	private ValueCallback<Uri[]> pendingChooser;

	@SuppressLint("SetJavaScriptEnabled")
	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		JSONObject cfg = Prefs.get(this);
		String server = Prefs.server(this);
		if (server.isEmpty()) {
			finish();
			return;
		}
		host = Uri.parse(server).getHost();

		FrameLayout root = new FrameLayout(this);
		web = new WebView(this);
		root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
		setContentView(root);
		Ui.fitSystemBars(root);

		WebSettings s = web.getSettings();
		s.setJavaScriptEnabled(true);
		s.setDomStorageEnabled(true);
		s.setMediaPlaybackRequiresUserGesture(false);
		CookieManager.getInstance().setAcceptCookie(true);

		web.setWebViewClient(new WebViewClient() {
			@Override
			public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
				Uri u = request.getUrl();
				if (host != null && host.equalsIgnoreCase(u.getHost())) return false;
				try {
					startActivity(new Intent(Intent.ACTION_VIEW, u));
				} catch (ActivityNotFoundException e) {
					Toast.makeText(BoardsActivity.this, "No app can open this link", Toast.LENGTH_SHORT).show();
				}
				return true;
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
				Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
			} catch (Exception e) {
				Toast.makeText(this, "Download failed", Toast.LENGTH_SHORT).show();
			}
		});

		Map<String, String> headers = new HashMap<>();
		String user = cfg.optString("user", "");
		String pw = cfg.optString("appPassword", "");
		if (!user.isEmpty() && !pw.isEmpty()) {
			String raw = user + ":" + pw;
			headers.put("Authorization", "Basic " + Base64.encodeToString(raw.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
		}
		web.loadUrl(server + "/index.php/apps/curio/", headers);
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
		if (web != null && web.canGoBack()) web.goBack();
		else super.onBackPressed();
	}

	@Override
	protected void onPause() {
		super.onPause();
		CookieManager.getInstance().flush();
	}

	@Override
	protected void onDestroy() {
		if (web != null) web.destroy();
		super.onDestroy();
	}
}
