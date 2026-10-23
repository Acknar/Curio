package com.acknar.curio;

import android.graphics.Insets;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

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
}
