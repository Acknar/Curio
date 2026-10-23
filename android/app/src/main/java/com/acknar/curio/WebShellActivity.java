package com.acknar.curio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

/**
 * Hosts one of the bundled pages (assets/ui/*.html) in a WebView wired to
 * NativeBridge. The pages hold all the UI; this class only provides the shell.
 */
abstract class WebShellActivity extends Activity {
	protected WebView web;
	protected FrameLayout root;
	private Renderer renderer;

	/** The asset page to load, e.g. "ui/home.html". */
	protected abstract String page();

	protected boolean transparent() {
		return false;
	}

	@SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		root = new FrameLayout(this);
		web = new WebView(this);
		if (transparent()) web.setBackgroundColor(0);
		root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
		setContentView(root);
		Ui.fitSystemBars(root);
		if (!transparent()) Ui.applyLook(this, root, Prefs.get(this).optJSONObject("look"));

		WebSettings s = web.getSettings();
		s.setJavaScriptEnabled(true);
		s.setDomStorageEnabled(true);
		s.setAllowFileAccess(false);
		CookieManager.getInstance().setAcceptCookie(true);

		web.addJavascriptInterface(new NativeBridge(this, web), "Android");
		web.setWebChromeClient(new WebChromeClient());
		web.setWebViewClient(new WebViewClient() {
			@Override
			public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
				Uri u = request.getUrl();
				if ("file".equals(u.getScheme())) return false;
				// Links in the bundled pages open in the browser, never inside the shell.
				try {
					startActivity(new Intent(Intent.ACTION_VIEW, u));
				} catch (ActivityNotFoundException ignored) {
					// nothing to open it with
				}
				return true;
			}
		});
		web.loadUrl("file:///android_asset/" + page());
	}

	Renderer renderer() {
		if (renderer == null) renderer = new Renderer(this, root);
		return renderer;
	}

	/** Overridden by the share sheet. */
	JSONObject sharedPayload() {
		return new JSONObject();
	}

	/** Overridden by the share sheet. */
	Http.SharedSource sharedSource() {
		return null;
	}

	@Override
	public void onBackPressed() {
		// Let the page close an open panel first; it answers "true" when it handled it.
		web.evaluateJavascript("(window.CurioApp&&CurioApp.back)?CurioApp.back():false", value -> {
			if (!"true".equals(value)) super.onBackPressed();
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
}
