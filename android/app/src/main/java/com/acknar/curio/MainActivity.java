package com.acknar.curio;

import android.content.Intent;

import org.json.JSONObject;

/** Home, first-run connection and settings (assets/ui/home.html). */
public class MainActivity extends WebShellActivity {
	static final String EXTRA_VIEW = "view";

	@Override
	protected String page() {
		String view = getIntent().getStringExtra(EXTRA_VIEW);
		return "ui/home.html" + (view != null ? "#" + view : "");
	}

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);
		setIntent(intent);
		String view = intent.getStringExtra(EXTRA_VIEW);
		if (view != null && web != null) {
			web.evaluateJavascript("window.CurioApp&&CurioApp.show(" + JSONObject.quote(view) + ")", null);
		}
	}

	@Override
	protected void onResume() {
		super.onResume();
		// Returning from a site sign-in or the boards view: refresh what the page shows.
		if (web != null) web.evaluateJavascript("window.CurioApp&&CurioApp.refresh&&CurioApp.refresh()", null);
	}
}
