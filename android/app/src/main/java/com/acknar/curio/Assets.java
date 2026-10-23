package com.acknar.curio;

import android.content.Context;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

final class Assets {
	private Assets() {}

	static String read(Context ctx, String path) {
		try (InputStream in = ctx.getAssets().open(path)) {
			return new String(Http.readAll(in, 4 * 1024 * 1024), StandardCharsets.UTF_8);
		} catch (IOException e) {
			return "";
		}
	}
}
