package com.acknar.curio;

/** App settings, opened from Curio's sidebar or the share sheet (assets/ui/settings.html). */
public class SettingsActivity extends WebShellActivity {
	@Override
	protected String page() {
		return "ui/settings.html";
	}

	@Override
	protected void onResume() {
		super.onResume();
		// Back from a site sign-in: refresh the signed-in states.
		if (web != null) web.evaluateJavascript("window.CurioApp&&CurioApp.refresh&&CurioApp.refresh()", null);
	}
}
