package com.acknar.curio;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import org.json.JSONObject;

final class Ui {
	private Ui() {}

	/**
	 * Android 15 draws apps edge to edge and ignores adjustResize, so pad the root by
	 * the system bars and the keyboard ourselves. Older versions already do this.
	 */
	static void fitSystemBars(View root) {
		if (Build.VERSION.SDK_INT < 35) return;
		root.setOnApplyWindowInsetsListener((v, insets) -> {
			Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
			v.setPadding(i.left, i.top, i.right, i.bottom);
			return WindowInsets.CONSUMED;
		});
	}

	/**
	 * Colour the system bars like Curio (its --bg colour, light or dark icons), from
	 * the look the Curio page reported. Without one, follow the system theme.
	 */
	@SuppressWarnings("deprecation")
	static void applyLook(Activity a, View root, JSONObject look) {
		boolean night = (a.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
				== android.content.res.Configuration.UI_MODE_NIGHT_YES;
		boolean dark = look != null && look.has("theme") ? "dark".equals(look.optString("theme")) : night;
		int bg = parse(look != null ? look.optString("bg", "") : "", dark ? 0xFF121417 : 0xFFF5F6F8);
		root.setBackgroundColor(bg);
		if (Build.VERSION.SDK_INT < 35) {
			a.getWindow().setStatusBarColor(bg);
			a.getWindow().setNavigationBarColor(bg);
		}
		if (Build.VERSION.SDK_INT >= 30) {
			WindowInsetsController c = a.getWindow().getInsetsController();
			if (c != null) {
				int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
				c.setSystemBarsAppearance(dark ? 0 : mask, mask);
			}
		} else {
			View d = a.getWindow().getDecorView();
			int f = d.getSystemUiVisibility();
			int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
			d.setSystemUiVisibility(dark ? (f & ~light) : (f | light));
		}
	}

	/** Parses "#rrggbb", "#rgb" or "rgb(r, g, b)"; anything else gives the fallback. */
	static int parse(String c, int fallback) {
		if (c == null) return fallback;
		c = c.trim();
		try {
			if (c.matches("#[0-9a-fA-F]{3}")) {
				return Color.rgb(Integer.parseInt(c.substring(1, 2), 16) * 17, Integer.parseInt(c.substring(2, 3), 16) * 17, Integer.parseInt(c.substring(3, 4), 16) * 17);
			}
			if (c.matches("#[0-9a-fA-F]{6}")) return Color.parseColor(c);
			java.util.regex.Matcher m = java.util.regex.Pattern.compile("rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)").matcher(c);
			if (m.find()) return Color.rgb(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
		} catch (Exception ignored) {
			// fall through
		}
		return fallback;
	}
}
