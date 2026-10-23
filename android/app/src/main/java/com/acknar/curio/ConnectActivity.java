package com.acknar.curio;

/** First run: connect to Nextcloud (assets/ui/connect.html). */
public class ConnectActivity extends WebShellActivity {
	@Override
	protected String page() {
		return "ui/connect.html";
	}
}
