package com.acknar.curio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

/**
 * Loads a page in an invisible WebView (sharing the app's cookies, so a site the
 * user signed into renders as it does for them) and runs the clipper's page
 * extractor (assets/ui/page-extractors.js, the browser extension's extractors.js)
 * against the live DOM. This is the phone equivalent of the extension reading the
 * page in the user's logged-in browser, used when plain HTTP fetches came back empty.
 */
final class Renderer {
	interface Callback {
		void done(JSONObject result);
	}

	private static final long POLL_MS = 700;

	private final Activity activity;
	private final ViewGroup host;

	Renderer(Activity activity, ViewGroup host) {
		this.activity = activity;
		this.host = host;
	}

	/** spec: { url, timeoutMs, info{} }. Must be called on the main thread. */
	@SuppressLint("SetJavaScriptEnabled")
	void render(JSONObject spec, Callback cb) {
		final String url = spec.optString("url");
		final long timeout = spec.optLong("timeoutMs", 12000);
		final JSONObject info = spec.optJSONObject("info") != null ? spec.optJSONObject("info") : new JSONObject();
		final String extractor = Assets.read(activity, "ui/page-extractors.js");
		final Handler main = new Handler(Looper.getMainLooper());
		final long started = System.currentTimeMillis();
		final boolean[] finished = { false };

		final WebView wv = new WebView(activity);
		WebSettings s = wv.getSettings();
		s.setJavaScriptEnabled(true);
		s.setDomStorageEnabled(true);
		s.setMediaPlaybackRequiresUserGesture(true);
		s.setUserAgentString(Http.UA_MOBILE);
		s.setBlockNetworkImage(true);
		CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);
		wv.setAlpha(0f);
		wv.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
		// A real viewport size so lazy layouts render their content.
		FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(1080, 1920);
		host.addView(wv, 0, lp);

		final Runnable finish = new Runnable() {
			@Override
			public void run() {
				if (finished[0]) return;
				finished[0] = true;
				host.removeView(wv);
				wv.stopLoading();
				wv.destroy();
			}
		};

		final String probe = "(function(){try{" + extractor + "\n;var d=CurioExtract.page(" + info.toString() + ");"
				+ "d.ready=!!(d.description||(d.images&&d.images.length)||d.videoFileUrl);"
				+ "d.finalUrl=location.href;return JSON.stringify(d);}catch(e){return JSON.stringify({error:String(e)});}})()";

		final Runnable[] poll = new Runnable[1];
		poll[0] = new Runnable() {
			@Override
			public void run() {
				if (finished[0]) return;
				wv.evaluateJavascript(probe, value -> {
					if (finished[0]) return;
					JSONObject data = parse(value);
					boolean timedOut = System.currentTimeMillis() - started > timeout;
					if ((data != null && data.optBoolean("ready")) || timedOut) {
						cb.done(data != null ? data : Http.error("render", "No page data"));
						finish.run();
					} else {
						main.postDelayed(poll[0], POLL_MS);
					}
				});
			}
		};

		wv.setWebViewClient(new WebViewClient() {
			private boolean polling = false;

			@Override
			public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
				String scheme = request.getUrl().getScheme();
				// Stay on http(s); never hand off to another app (intent://, market://...).
				return scheme == null || !(scheme.equals("http") || scheme.equals("https"));
			}

			@Override
			public void onPageFinished(WebView view, String loaded) {
				if (!polling) {
					polling = true;
					main.postDelayed(poll[0], 900);
				}
			}
		});

		// Hard stop, even if the page never finishes loading.
		main.postDelayed(() -> {
			if (finished[0]) return;
			wv.evaluateJavascript(probe, value -> {
				if (finished[0]) return;
				JSONObject data = parse(value);
				cb.done(data != null ? data : Http.error("render", "Timed out"));
				finish.run();
			});
		}, timeout + 2500);

		wv.loadUrl(url);
	}

	private static JSONObject parse(String jsValue) {
		// evaluateJavascript hands back the JSON encoding of the returned string.
		try {
			if (jsValue == null || "null".equals(jsValue)) return null;
			String s = new org.json.JSONTokener(jsValue).nextValue().toString();
			return new JSONObject(s);
		} catch (Exception e) {
			return null;
		}
	}
}
