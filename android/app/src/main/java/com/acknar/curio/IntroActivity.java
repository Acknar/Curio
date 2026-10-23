package com.acknar.curio;

/**
 * Introduction shown once after connecting, and from App settings
 * (assets/ui/intro.html): the share menu, what it reads, site sign-ins and the
 * default board.
 */
public class IntroActivity extends WebShellActivity {
	@Override
	protected String page() {
		return "ui/intro.html";
	}

	@Override
	protected void onResume() {
		super.onResume();
		// Back from a site sign-in: refresh the signed-in states.
		if (web != null) web.evaluateJavascript("window.CurioApp&&CurioApp.refresh&&CurioApp.refresh()", null);
	}
}
