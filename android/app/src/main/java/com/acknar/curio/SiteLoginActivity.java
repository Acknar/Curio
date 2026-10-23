package com.acknar.curio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Signs into a social site inside the app (Instagram, Facebook...). The site's own
 * login page runs in this WebView; Curio never sees the password. The session
 * cookie it leaves behind is what lets the clipper read private or login-walled
 * posts, the same way the browser extension relied on the user's logged-in browser.
 */
public class SiteLoginActivity extends Activity {
	static final String EXTRA_URL = "url";
	static final String EXTRA_SITE = "site";

	private WebView web;

	@SuppressLint("SetJavaScriptEnabled")
	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		String url = getIntent().getStringExtra(EXTRA_URL);
		String site = getIntent().getStringExtra(EXTRA_SITE);

		LinearLayout col = new LinearLayout(this);
		col.setOrientation(LinearLayout.VERTICAL);

		LinearLayout bar = new LinearLayout(this);
		bar.setOrientation(LinearLayout.HORIZONTAL);
		bar.setGravity(Gravity.CENTER_VERTICAL);
		int pad = dp(12);
		bar.setPadding(pad, dp(6), dp(6), dp(6));
		TextView title = new TextView(this);
		title.setText("Sign in to " + (site == null ? "site" : capital(site)));
		title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
		bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
		Button done = new Button(this);
		done.setText("Done");
		done.setTextColor(Color.parseColor("#0069C2"));
		done.setBackgroundColor(Color.TRANSPARENT);
		done.setOnClickListener(v -> finish());
		bar.addView(done);
		col.addView(bar);

		web = new WebView(this);
		WebSettings s = web.getSettings();
		s.setJavaScriptEnabled(true);
		s.setDomStorageEnabled(true);
		// Some sites refuse sign-in from an embedded browser ("; wv"); present as Chrome.
		s.setUserAgentString(Http.UA_MOBILE);
		CookieManager.getInstance().setAcceptCookie(true);
		CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
		web.setWebViewClient(new WebViewClient() {
			@Override
			public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
				String scheme = request.getUrl().getScheme();
				return scheme == null || !(scheme.equals("http") || scheme.equals("https"));
			}
		});
		col.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
		setContentView(col);
		Ui.fitSystemBars(col);
		web.loadUrl(url == null ? "about:blank" : url);
	}

	private int dp(int v) {
		return Math.round(v * getResources().getDisplayMetrics().density);
	}

	private static String capital(String s) {
		if (s.equals("x")) return "X";
		return Character.toUpperCase(s.charAt(0)) + s.substring(1);
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
